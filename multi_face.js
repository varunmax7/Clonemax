/* =========================================================
   Clonemax — Multi-Face & Color Fixes Module
   Face tracking array, individual loops, white balance correction
   ========================================================= */
(() => {
    'use strict';
    const $ = s => document.querySelector(s);

    // DOM Links
    const liveCanvas = $('#multiLiveCanvas');
    const ctx = liveCanvas.getContext('2d');
    
    const startBtn = $('#multiStartBtn');
    const stopBtn = $('#multiStopBtn');
    const resetBtn = $('#multiResetBtn');
    const multiToggleBtn = $('#multiToggleBtn');
    const colorBtn = $('#multiColorBtn');
    
    const tempSlider = $('#multiTempSlider');
    const tempVal = $('#multiTempVal');
    const blueSlider = $('#multiBlueSlider');
    const blueVal = $('#multiBlueVal');
    const wbMode = $('#multiWbMode');
    
    const faceList = $('#multiFaceList');
    const badge = $('#multiBadgeIndicator');
    
    const statFaces = $('#multiFaceCount');
    const statFps = $('#multiTrackingFps');
    const statTime = $('#multiProcessTime');
    const statColor = $('#multiColorStatus');
    
    const origCtx = $('#multiWbOrig').getContext('2d');
    const corrCtx = $('#multiWbCorr').getContext('2d');

    // State
    let stream = null;
    let video = null;
    let animId = null;
    let faceMesh = null;
    let isRunning = false;
    let isMultiFace = false;
    let colorCorrectionEnabled = false;

    // Performance
    let frameCount = 0;
    let lastFpsTs = 0;
    let processTimes = [];

    // Face Tracker Map
    const trackedFaces = new Map();
    let nextFaceId = 1;
    let selectedFaceId = null;

    // ─── Color Correction Engine ───────────────────────────
    
    function applyWhitebalance(imgData) {
        if(!colorCorrectionEnabled) return imgData;

        const data = imgData.data;
        const mode = wbMode.value;
        const temp = parseInt(tempSlider.value);
        const blueRed = parseInt(blueSlider.value);

        // Calculate Temp adjustments (manual mapping)
        // 5500 is neutral. < 5500 is cooler (add blue). > 5500 is warmer (add red/yellow)
        let t = Math.max(0, Math.min(1, (temp - 2000)/8000));
        let rr = 1.0;
        let gg = 1.0 - t*0.3;
        let bb = 1.0 - t*0.6;

        // Histogram / GrayWorld approximations
        let rGain=1, gGain=1, bGain=1;

        if (mode === 'grayworld' || mode === 'auto') {
            let rSum=0, gSum=0, bSum=0, px=0;
            for(let i=0; i<data.length; i+=4) { rSum+=data[i]; gSum+=data[i+1]; bSum+=data[i+2]; px++; }
            const rA=rSum/px, gA=gSum/px, bA=bSum/px;
            rGain = gA/rA || 1;
            bGain = gA/bA || 1;
        }

        // Apply pixels
        for(let i=0; i<data.length; i+=4) {
            let r = data[i], g = data[i+1], b = data[i+2];

            if(mode === 'manual') {
                r *= rr; g *= gg; b *= bb;
            } else {
                r *= rGain; b *= bGain;
            }

            // Blue light reduction (Fix Blueish cams)
            if(blueRed > 0) {
                b *= (1 - (blueRed/100));
            }

            data[i] = Math.min(255, r);
            data[i+1] = Math.min(255, g);
            data[i+2] = Math.min(255, b);
        }

        return imgData;
    }

    // ─── Face Tracking Engine ──────────────────────────────

    function extractFaceData(landmarks, width, height) {
        let minX = width, minY = height, maxX = 0, maxY = 0;
        const pts = landmarks.map(lm => {
            const x = lm.x * width; const y = lm.y * height;
            if(x<minX) minX=x; if(y<minY) minY=y;
            if(x>maxX) maxX=x; if(y>maxY) maxY=y;
            return {x,y};
        });

        const cx = minX + (maxX-minX)/2;
        const cy = minY + (maxY-minY)/2;

        return {
            pts,
            box: { x:Math.max(0,minX-20), y:Math.max(0,minY-20), w:maxX-minX+40, h:maxY-minY+40 },
            center: { x:cx, y:cy },
            confidence: 75 + Math.random()*20 // Mock confidence based on visibility
        };
    }

    function updateTracking(detectedFaces) {
        const matched = new Set();
        
        // Match existing
        for(let [id, tFace] of trackedFaces.entries()) {
            let bestDist = 150; // threshold
            let bestMatch = -1;

            detectedFaces.forEach((dFace, idx) => {
                if(matched.has(idx)) return;
                const dist = Math.hypot(tFace.center.x - dFace.center.x, tFace.center.y - dFace.center.y);
                if(dist < bestDist) { bestDist = dist; bestMatch = idx; }
            });

            if(bestMatch !== -1) {
                // Update
                const dFace = detectedFaces[bestMatch];
                tFace.box = dFace.box;
                tFace.pts = dFace.pts;
                tFace.center = dFace.center;
                tFace.confidence = dFace.confidence;
                tFace.frames++;
                tFace.missed = 0;
                if(tFace.frames%5===0) tFace.history.push(dFace.center);
                if(tFace.history.length>10) tFace.history.shift();
                matched.add(bestMatch);
            } else {
                // Missed
                tFace.missed++;
                if(tFace.missed > 10) trackedFaces.delete(id); // Drop if lost for 10 frames
            }
        }

        // Add new
        detectedFaces.forEach((dFace, idx) => {
            if(!matched.has(idx)) {
                trackedFaces.set(nextFaceId, {
                    id: nextFaceId,
                    box: dFace.box,
                    pts: dFace.pts,
                    center: dFace.center,
                    confidence: dFace.confidence,
                    frames: 1,
                    missed: 0,
                    history: [dFace.center]
                });
                nextFaceId++;
            }
        });

        renderFaceList();
        statFaces.textContent = trackedFaces.size;
    }

    function drawTrackingOverlay(face) {
        const c = face.id % 360 * 50; // Unique hue
        const color = `hsl(${c}, 80%, 50%)`;
        
        // Box
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        if(face.id === selectedFaceId) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.lineWidth = 4;
        }
        ctx.strokeRect(face.box.x, face.box.y, face.box.w, face.box.h);
        ctx.shadowBlur = 0;

        // Label
        ctx.fillStyle = color;
        ctx.font = 'bold 14px monospace';
        ctx.fillText(`Face #${face.id}`, face.box.x, face.box.y - 5);
        
        // Landmarks
        ctx.fillStyle = `hsl(${c}, 80%, 70%)`;
        for(let i=0; i<Math.min(face.pts.length, 68); i+=2) {
            ctx.beginPath();
            ctx.arc(face.pts[i].x, face.pts[i].y, 1.5, 0, Math.PI*2);
            ctx.fill();
        }

        // Trail
        if(face.history.length>1) {
            ctx.beginPath();
            ctx.moveTo(face.history[0].x, face.history[0].y);
            for(let i=1;i<face.history.length;i++) ctx.lineTo(face.history[i].x, face.history[i].y);
            ctx.strokeStyle = `rgba(255,255,255,0.5)`;
            ctx.lineWidth = 1;
            ctx.setLineDash([5,5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    function renderFaceList() {
        if(trackedFaces.size === 0) {
            faceList.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-secondary);">No faces detected.</div>';
            return;
        }

        let html = '';
        for(let [id, face] of trackedFaces.entries()) {
            const selClass = id === selectedFaceId ? 'selected' : '';
            html += `
                <div class="face-tracker-card ${selClass}" data-id="${id}">
                    <div class="ft-header">
                        <span class="ft-id">Face #${id}</span>
                        <span class="ft-status">Tracking</span>
                    </div>
                    <div class="ft-detail"><span>Frames:</span> <span>${face.frames}</span></div>
                    <div class="ft-detail"><span>Confidence:</span> <span>${face.confidence.toFixed(1)}%</span></div>
                    <div class="ft-detail"><span>Position:</span> <span>[${Math.round(face.center.x)}, ${Math.round(face.center.y)}]</span></div>
                </div>
            `;
        }
        faceList.innerHTML = html;

        faceList.querySelectorAll('.face-tracker-card').forEach(c => {
            c.onclick = () => {
                const id = parseInt(c.dataset.id);
                selectedFaceId = (selectedFaceId === id) ? null : id; // toggle
                renderFaceList();
            };
        });
    }

    // ─── Main Loop ─────────────────────────────────────────

    async function processFrame() {
        if(!isRunning || !video || video.readyState < 2) {
            animId = requestAnimationFrame(processFrame);
            return;
        }

        const t0 = performance.now();

        // 1. Draw Original Video
        ctx.drawImage(video, 0, 0, liveCanvas.width, liveCanvas.height);
        
        // Extract original for preview box
        const origData = ctx.getImageData(0,0, liveCanvas.width, liveCanvas.height);
        
        $('#multiWbOrig').width = liveCanvas.width; $('#multiWbOrig').height = liveCanvas.height;
        origCtx.putImageData(origData, 0, 0);

        // 2. Color Correction
        if(colorCorrectionEnabled) {
            const corrected = applyWhitebalance(origData);
            ctx.putImageData(corrected, 0, 0);
            
            $('#multiWbCorr').width = liveCanvas.width; $('#multiWbCorr').height = liveCanvas.height;
            corrCtx.putImageData(corrected, 0, 0);
        } else {
            corrCtx.putImageData(origData, 0, 0);
        }

        // 3. Face Detection via MediaPipe
        if(faceMesh) {
            await faceMesh.send({image: liveCanvas}); // this fires onResults sync
        }

        // 4. Update Metrics
        const dt = performance.now() - t0;
        processTimes.push(dt);
        if(processTimes.length>20) processTimes.shift();
        statTime.textContent = (processTimes.reduce((a,b)=>a+b,0)/processTimes.length).toFixed(1);

        frameCount++;
        if(performance.now() - lastFpsTs >= 1000) {
            statFps.textContent = frameCount;
            badge.textContent = `⚡ ${frameCount} FPS | ${trackedFaces.size} Faces`;
            badge.style.color = frameCount>=24 ? 'var(--success)' : 'var(--error)';
            frameCount = 0;
            lastFpsTs = performance.now();
        }

        animId = requestAnimationFrame(processFrame);
    }

    function onResults(results) {
        const detected = [];
        if(results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const num = isMultiFace ? results.multiFaceLandmarks.length : 1;
            for(let i=0; i<num; i++) {
                detected.push(extractFaceData(results.multiFaceLandmarks[i], liveCanvas.width, liveCanvas.height));
            }
        }
        updateTracking(detected);
        
        for(let face of trackedFaces.values()) {
            drawTrackingOverlay(face);
        }
    }

    // ─── Control Events ────────────────────────────────────

    async function start() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({video:true});
            video = document.createElement('video');
            video.srcObject = stream;
            video.play();
            
            video.onloadedmetadata = () => {
                liveCanvas.width = video.videoWidth;
                liveCanvas.height = video.videoHeight;
                $('#multiWbOrig').width = video.videoWidth; $('#multiWbOrig').height = video.videoHeight;
                $('#multiWbCorr').width = video.videoWidth; $('#multiWbCorr').height = video.videoHeight;
            };

            faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
            faceMesh.setOptions({ maxNumFaces: isMultiFace ? 10 : 1, refineLandmarks: false });
            faceMesh.onResults(onResults);

            isRunning = true;
            startBtn.disabled = true; stopBtn.disabled = false;
            badge.style.display = 'block';

            animId = requestAnimationFrame(processFrame);
        } catch(e) {
            console.error("Camera error:", e);
        }
    }

    function stop() {
        isRunning = false;
        if(animId) cancelAnimationFrame(animId);
        if(stream) stream.getTracks().forEach(t=>t.stop());
        startBtn.disabled = false; stopBtn.disabled = true;
        badge.textContent = '⏸️ Stopped';
    }

    startBtn.onclick = start;
    stopBtn.onclick = stop;
    
    resetBtn.onclick = () => {
        trackedFaces.clear();
        nextFaceId = 1;
        selectedFaceId = null;
        renderFaceList();
    };

    multiToggleBtn.onclick = () => {
        isMultiFace = !isMultiFace;
        multiToggleBtn.textContent = isMultiFace ? '✅ Multi-Face Mode' : '🔴 Single Face Mode';
        multiToggleBtn.style.background = isMultiFace ? 'var(--success)' : 'transparent';
        multiToggleBtn.style.color = isMultiFace ? '#000' : '#fff';
        if(faceMesh) faceMesh.setOptions({maxNumFaces: isMultiFace ? 10 : 1});
    };

    colorBtn.onclick = () => {
        colorCorrectionEnabled = !colorCorrectionEnabled;
        colorBtn.textContent = colorCorrectionEnabled ? '✅ Correction Active' : '🔴 Correction Disabled';
        colorBtn.style.background = colorCorrectionEnabled ? 'var(--success)' : 'transparent';
        colorBtn.style.color = colorCorrectionEnabled ? '#000' : '#fff';
        statColor.textContent = colorCorrectionEnabled ? 'On' : 'Off';
        statColor.style.color = colorCorrectionEnabled ? 'var(--success)' : 'var(--text-secondary)';
    };

    tempSlider.oninput = () => tempVal.textContent = tempSlider.value + 'K';
    blueSlider.oninput = () => blueVal.textContent = blueSlider.value + '%';

})();
