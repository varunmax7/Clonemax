/* =========================================================
   Clonemax — Face Detection & Landmark Extraction Module
   MediaPipe Face Mesh (468 pts) + Face-API.js (68 pts)
   ========================================================= */

(() => {
    'use strict';

    const $ = (sel) => document.querySelector(sel);

    // ─── DOM ───────────────────────────────────────────────
    const detVideoFeed      = $('#detVideoFeed');
    const detVideoPlaceholder = $('#detVideoPlaceholder');
    const detLandmarkCanvas = $('#detLandmarkCanvas');
    const detCameraSelect   = $('#detCameraSelect');
    const detDetectorType   = $('#detDetectorType');
    const detStartBtn       = $('#detStartBtn');
    const detStopBtn        = $('#detStopBtn');
    const detSingleMode     = $('#detSingleMode');
    const detMultiMode      = $('#detMultiMode');
    const detLiveBadge      = $('#detLiveBadge');
    const detFpsEl          = $('#detFps');
    const detFacesEl        = $('#detFaces');
    const detLandmarksEl    = $('#detLandmarks');
    const detTimeEl         = $('#detTime');
    const detRefImage       = $('#detRefImage');
    const detRefCanvas      = $('#detRefCanvas');
    const detRefEmpty       = $('#detRefEmpty');
    const detUploadRefBtn   = $('#detUploadRefBtn');
    const detAnalyzeRefBtn  = $('#detAnalyzeRefBtn');
    const detClearRefBtn    = $('#detClearRefBtn');
    const detRefInfo        = $('#detRefInfo');
    const detFaceList       = $('#detFaceList');
    const detLandmarkCard   = $('#detLandmarkCard');
    const detFaceLabel      = $('#detFaceLabel');
    const detEyeDist        = $('#detEyeDist');
    const detFaceW          = $('#detFaceW');
    const detFaceH          = $('#detFaceH');
    const detHeadRot        = $('#detHeadRot');
    const detCoordsScroll   = $('#detCoordsScroll');
    const detPerfBadge      = $('#detPerfBadge');

    // ─── State ─────────────────────────────────────────────
    let stream           = null;
    let isRunning        = false;
    let faceMeshInstance = null;
    let mpCamera         = null;
    let currentDetector  = 'mediapipe';
    let multiFace        = false;
    let currentFaces     = [];
    let selectedIdx      = 0;
    let frameCount       = 0;
    let lastFpsTs        = 0;
    let detTimes         = [];
    let faceApiReady     = false;
    let faceApiAnimId    = null;

    // MediaPipe key landmark indices
    const MP = {
        LEFT_EYE:  [33, 133, 157, 158, 159, 160, 161, 173],
        RIGHT_EYE: [362, 263, 387, 386, 385, 384, 398, 466],
        NOSE:      [1, 2, 4, 5, 6, 19, 94, 195],
        MOUTH:     [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185],
        OVAL:      [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
        LEFT_IRIS: [468,469,470,471,472],
        RIGHT_IRIS:[473,474,475,476,477],
    };

    // Colours for drawing
    const COLORS = {
        point:     '#f87171',
        selected:  '#34d399',
        box:       '#fbbf24',
        leftEye:   '#818cf8',
        rightEye:  '#818cf8',
        nose:      '#fbbf24',
        mouth:     '#f87171',
        oval:      '#34d399',
        iris:      '#c084fc',
    };

    // ─── Init MediaPipe ────────────────────────────────────
    function initMediaPipe() {
        faceMeshInstance = new FaceMesh({
            locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        faceMeshInstance.setOptions({
            maxNumFaces: multiFace ? 10 : 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5,
        });
        faceMeshInstance.onResults(onMPResults);
    }

    // ─── Init Face-API (lazy) ──────────────────────────────
    async function ensureFaceApi() {
        if (faceApiReady) return true;
        detPerfBadge.textContent = '📦 Loading Face-API…';
        try {
            const BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(BASE),
                faceapi.nets.faceLandmark68Net.loadFromUri(BASE),
            ]);
            faceApiReady = true;
            detPerfBadge.textContent = '⚡ Ready';
            return true;
        } catch (e) {
            console.error('Face-API load failed', e);
            detPerfBadge.textContent = '❌ Face-API failed';
            return false;
        }
    }

    // ─── Camera ────────────────────────────────────────────
    async function enumCameras() {
        try {
            const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
            tmp.getTracks().forEach(t => t.stop());
            const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
            detCameraSelect.innerHTML = devs.length
                ? devs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'Camera ' + (i + 1)}</option>`).join('')
                : '<option value="">No cameras</option>';
        } catch { detCameraSelect.innerHTML = '<option value="">Permission needed</option>'; }
    }

    async function startDetection() {
        stopDetection();
        const id = detCameraSelect.value;
        const constraints = { video: id ? { deviceId: { exact: id } } : true };

        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            detVideoFeed.srcObject = stream;
            await new Promise(r => { detVideoFeed.onloadedmetadata = r; });
            await detVideoFeed.play();

            isRunning = true;
            detVideoPlaceholder.style.display = 'none';
            detLiveBadge.style.display = 'inline-flex';
            detStartBtn.disabled = true;
            detStopBtn.disabled  = false;
            frameCount = 0;
            lastFpsTs  = performance.now();
            detTimes   = [];

            if (currentDetector === 'mediapipe') {
                startMPLoop();
            } else {
                const ok = await ensureFaceApi();
                if (ok) startFaceApiLoop();
            }
        } catch (e) {
            console.error(e);
            detPerfBadge.textContent = '❌ Camera failed';
        }
    }

    function stopDetection() {
        isRunning = false;
        if (mpCamera) { mpCamera.stop(); mpCamera = null; }
        if (faceApiAnimId) { cancelAnimationFrame(faceApiAnimId); faceApiAnimId = null; }
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        detVideoFeed.srcObject = null;
        detVideoPlaceholder.style.display = '';
        detLiveBadge.style.display = 'none';
        detStartBtn.disabled = false;
        detStopBtn.disabled  = true;
        detFpsEl.textContent = '0';
        detFacesEl.textContent = '0';
        detPerfBadge.textContent = '⏸ Stopped';
    }

    // ─── MediaPipe Loop ────────────────────────────────────
    function startMPLoop() {
        mpCamera = new Camera(detVideoFeed, {
            onFrame: async () => {
                if (!isRunning) return;
                await faceMeshInstance.send({ image: detVideoFeed });
            },
            width: 640, height: 480,
        });
        mpCamera.start();
    }

    function onMPResults(results) {
        if (!isRunning) return;
        const t0 = performance.now();
        const vw = detVideoFeed.videoWidth;
        const vh = detVideoFeed.videoHeight;

        const canvas = detLandmarkCanvas;
        canvas.width = vw; canvas.height = vh;
        canvas.style.width = '100%'; canvas.style.height = '100%';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, vw, vh);

        currentFaces = [];
        const ml = results.multiFaceLandmarks || [];
        const count = Math.min(ml.length, multiFace ? 10 : 1);

        for (let i = 0; i < count; i++) {
            const lm = ml[i];
            const face = extractMPFace(lm, vw, vh);
            currentFaces.push(face);
            drawMPFace(ctx, lm, vw, vh, i === selectedIdx);
        }

        // Stats
        detFacesEl.textContent = currentFaces.length;
        detLandmarksEl.textContent = currentFaces[0]?.pts.length || 0;
        updateFaceList();
        if (currentFaces[selectedIdx]) updateDetails(currentFaces[selectedIdx]);

        const dt = performance.now() - t0;
        detTimes.push(dt);
        if (detTimes.length > 30) detTimes.shift();
        detTimeEl.textContent = (detTimes.reduce((a, b) => a + b) / detTimes.length).toFixed(1);

        updateFps();
    }

    function extractMPFace(lm, w, h) {
        const pts = lm.map(p => ({ x: p.x * w, y: p.y * h, z: (p.z || 0) * 100 }));
        const le = pts[MP.LEFT_EYE[0]], re = pts[MP.RIGHT_EYE[0]];
        const eyeDist = Math.hypot(re.x - le.x, re.y - le.y);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        MP.OVAL.forEach(i => { if (pts[i]) { minX = Math.min(minX, pts[i].x); minY = Math.min(minY, pts[i].y); maxX = Math.max(maxX, pts[i].x); maxY = Math.max(maxY, pts[i].y); } });
        const rot = Math.atan2(re.y - le.y, re.x - le.x) * 180 / Math.PI;
        return { pts, eyeDist, faceW: maxX - minX, faceH: maxY - minY, rot, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
    }

    function drawMPFace(ctx, lm, w, h, sel) {
        const r = sel ? 2.5 : 1.5;

        // Connect landmark groups
        const groups = [
            { idx: MP.LEFT_EYE, col: COLORS.leftEye, close: true },
            { idx: MP.RIGHT_EYE, col: COLORS.rightEye, close: true },
            { idx: MP.NOSE, col: COLORS.nose, close: false },
            { idx: MP.MOUTH, col: COLORS.mouth, close: true },
            { idx: MP.OVAL, col: COLORS.oval, close: true },
        ];

        // Add iris if refined landmarks exist
        if (lm.length > 468) {
            groups.push({ idx: MP.LEFT_IRIS, col: COLORS.iris, close: true });
            groups.push({ idx: MP.RIGHT_IRIS, col: COLORS.iris, close: true });
        }

        groups.forEach(({ idx, col, close }) => {
            ctx.strokeStyle = col;
            ctx.lineWidth = sel ? 1.5 : 1;
            ctx.beginPath();
            idx.forEach((pi, j) => {
                if (pi >= lm.length) return;
                const x = lm[pi].x * w, y = lm[pi].y * h;
                j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            if (close) ctx.closePath();
            ctx.stroke();
        });

        // All points
        for (let i = 0; i < lm.length; i++) {
            ctx.fillStyle = sel ? COLORS.selected : COLORS.point;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.arc(lm[i].x * w, lm[i].y * h, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Bounding box for selected
        if (sel) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            lm.forEach(p => { const px = p.x * w, py = p.y * h; minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); });
            ctx.strokeStyle = COLORS.box;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(minX - 8, minY - 8, maxX - minX + 16, maxY - minY + 16);
            ctx.setLineDash([]);
            ctx.font = `bold ${Math.max(12, w * 0.02)}px Inter, sans-serif`;
            ctx.fillStyle = COLORS.box;
            ctx.fillText(`Face ${selectedIdx + 1}`, minX - 8, minY - 14);
        }
    }

    // ─── Face-API Loop ─────────────────────────────────────
    function startFaceApiLoop() {
        async function tick() {
            if (!isRunning) return;
            const t0 = performance.now();
            const opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
            const detections = await faceapi.detectAllFaces(detVideoFeed, opts).withFaceLandmarks();

            const vw = detVideoFeed.videoWidth;
            const vh = detVideoFeed.videoHeight;
            const canvas = detLandmarkCanvas;
            canvas.width = vw; canvas.height = vh;
            canvas.style.width = '100%'; canvas.style.height = '100%';
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, vw, vh);

            currentFaces = [];
            const limit = multiFace ? detections.length : Math.min(detections.length, 1);
            for (let i = 0; i < limit; i++) {
                const d = detections[i];
                const face = extractFaceApiFace(d);
                currentFaces.push(face);
                drawFaceApiFace(ctx, d, vw, vh, i === selectedIdx);
            }

            detFacesEl.textContent = currentFaces.length;
            detLandmarksEl.textContent = currentFaces[0]?.pts.length || 0;
            updateFaceList();
            if (currentFaces[selectedIdx]) updateDetails(currentFaces[selectedIdx]);

            const dt = performance.now() - t0;
            detTimes.push(dt);
            if (detTimes.length > 30) detTimes.shift();
            detTimeEl.textContent = (detTimes.reduce((a, b) => a + b) / detTimes.length).toFixed(1);

            updateFps();
            faceApiAnimId = requestAnimationFrame(tick);
        }
        faceApiAnimId = requestAnimationFrame(tick);
    }

    function extractFaceApiFace(det) {
        const pos = det.landmarks.positions;
        const pts = pos.map(p => ({ x: p.x, y: p.y, z: 0 }));
        const le = det.landmarks.getLeftEye(), re = det.landmarks.getRightEye();
        const lec = centroid(le), rec = centroid(re);
        const eyeDist = Math.hypot(rec.x - lec.x, rec.y - lec.y);
        const b = det.detection.box;
        const rot = Math.atan2(rec.y - lec.y, rec.x - lec.x) * 180 / Math.PI;
        return { pts, eyeDist, faceW: b.width, faceH: b.height, rot, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
    }

    function drawFaceApiFace(ctx, det, vw, vh, sel) {
        const pos = det.landmarks.positions;
        const r = sel ? 3 : 2;
        pos.forEach(p => {
            ctx.fillStyle = sel ? COLORS.selected : COLORS.point;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fill();
        });
        // Feature lines
        const groups = [
            det.landmarks.getLeftEye(), det.landmarks.getRightEye(),
            det.landmarks.getLeftEyeBrow(), det.landmarks.getRightEyeBrow(),
            det.landmarks.getNose(), det.landmarks.getMouth(), det.landmarks.getJawOutline(),
        ];
        const cols = [COLORS.leftEye, COLORS.rightEye, COLORS.iris, COLORS.iris, COLORS.nose, COLORS.mouth, COLORS.oval];
        groups.forEach((g, gi) => {
            if (g.length < 2) return;
            ctx.strokeStyle = cols[gi];
            ctx.lineWidth = sel ? 1.5 : 1;
            ctx.beginPath();
            g.forEach((p, j) => j === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
            ctx.stroke();
        });
        if (sel) {
            const b = det.detection.box;
            ctx.strokeStyle = COLORS.box;
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(b.x, b.y, b.width, b.height);
            ctx.setLineDash([]);
        }
    }

    function centroid(arr) {
        const s = arr.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
        return { x: s.x / arr.length, y: s.y / arr.length };
    }

    // ─── FPS ───────────────────────────────────────────────
    function updateFps() {
        frameCount++;
        const now = performance.now();
        if (now - lastFpsTs >= 1000) {
            const fps = frameCount;
            detFpsEl.textContent = fps;
            frameCount = 0;
            lastFpsTs = now;
            if (fps >= 25)      { detPerfBadge.style.color = '#34d399'; detPerfBadge.textContent = `⚡ ${fps} FPS`; }
            else if (fps >= 15) { detPerfBadge.style.color = '#fbbf24'; detPerfBadge.textContent = `⚠️ ${fps} FPS`; }
            else                { detPerfBadge.style.color = '#f87171'; detPerfBadge.textContent = `🐌 ${fps} FPS`; }
        }
    }

    // ─── Face List UI ──────────────────────────────────────
    function updateFaceList() {
        if (!currentFaces.length) {
            detFaceList.innerHTML = '<div class="frames-empty">No faces detected</div>';
            detLandmarkCard.style.display = 'none';
            return;
        }
        detLandmarkCard.style.display = '';
        detFaceList.innerHTML = currentFaces.map((f, i) => `
            <div class="det-face-item ${i === selectedIdx ? 'selected' : ''}" data-idx="${i}">
                <div>
                    <div class="face-label">Face ${i + 1}</div>
                    <div class="face-meta">${f.pts.length} landmarks</div>
                </div>
                <div class="face-right">
                    <div class="face-dims">${f.faceW.toFixed(0)}×${f.faceH.toFixed(0)}</div>
                    <div class="face-tilt">${f.rot.toFixed(1)}° tilt</div>
                </div>
            </div>`).join('');
        detFaceList.querySelectorAll('.det-face-item').forEach(el => {
            el.addEventListener('click', () => { selectedIdx = +el.dataset.idx; updateFaceList(); });
        });
    }

    function updateDetails(face) {
        detFaceLabel.textContent = `Face ${selectedIdx + 1}`;
        detEyeDist.textContent = face.eyeDist.toFixed(1) + ' px';
        detFaceW.textContent   = face.faceW.toFixed(1) + ' px';
        detFaceH.textContent   = face.faceH.toFixed(1) + ' px';
        detHeadRot.textContent = face.rot.toFixed(1) + '°';
        const sample = face.pts.slice(0, 15);
        detCoordsScroll.innerHTML = `<strong>First ${sample.length} of ${face.pts.length} landmarks:</strong><br>` +
            sample.map((p, i) => `[${i}] (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`).join('<br>') +
            (face.pts.length > 15 ? '<br>…' : '');
    }

    // ─── Reference Image ───────────────────────────────────
    function uploadRef() {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = (e) => {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = (ev) => {
                detRefImage.src = ev.target.result;
                detRefImage.style.display = 'block';
                detRefEmpty.style.display = 'none';
                detRefImage.onload = () => { detAnalyzeRefBtn.disabled = false; };
            };
            r.readAsDataURL(f);
        };
        inp.click();
    }

    async function analyzeRef() {
        if (!detRefImage.src || !detRefImage.complete) return;
        const ok = await ensureFaceApi();
        if (!ok) return;
        detPerfBadge.textContent = '🔍 Analyzing…';
        const dets = await faceapi.detectAllFaces(detRefImage).withFaceLandmarks();
        const canvas = detRefCanvas;
        canvas.width = detRefImage.naturalWidth;
        canvas.height = detRefImage.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (!dets.length) {
            detRefInfo.innerHTML = '<span style="color:var(--error)">❌ No face detected</span>';
            detPerfBadge.textContent = '⚡ Ready';
            return;
        }
        const d = dets[0];
        const pos = d.landmarks.positions;
        pos.forEach(p => { ctx.fillStyle = COLORS.selected; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill(); });
        const b = d.detection.box;
        ctx.strokeStyle = COLORS.box; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.width, b.height);

        detRefInfo.innerHTML = `<span style="color:var(--success)">✅ Face detected</span><br>Landmarks: ${pos.length} pts &nbsp;|&nbsp; Size: ${Math.round(b.width)}×${Math.round(b.height)} &nbsp;|&nbsp; Confidence: ${(d.detection.score * 100).toFixed(1)}%`;
        detPerfBadge.textContent = '⚡ Ready';
    }

    function clearRef() {
        detRefImage.src = ''; detRefImage.style.display = 'none';
        detRefEmpty.style.display = ''; detRefInfo.innerHTML = '';
        detAnalyzeRefBtn.disabled = true;
        const ctx = detRefCanvas.getContext('2d');
        ctx.clearRect(0, 0, detRefCanvas.width, detRefCanvas.height);
    }

    // Load saved reference from Module 1
    function loadSavedRef() {
        const saved = localStorage.getItem('clonemax_reference');
        if (saved) {
            detRefImage.src = saved;
            detRefImage.style.display = 'block';
            detRefEmpty.style.display = 'none';
            detAnalyzeRefBtn.disabled = false;
        }
    }

    // ─── Events ────────────────────────────────────────────
    detStartBtn.addEventListener('click', startDetection);
    detStopBtn.addEventListener('click', stopDetection);

    detDetectorType.addEventListener('change', (e) => {
        currentDetector = e.target.value;
        if (isRunning) { stopDetection(); setTimeout(startDetection, 150); }
    });

    detSingleMode.addEventListener('click', () => {
        multiFace = false;
        detSingleMode.classList.add('active'); detMultiMode.classList.remove('active');
        if (faceMeshInstance) faceMeshInstance.setOptions({ maxNumFaces: 1 });
    });
    detMultiMode.addEventListener('click', () => {
        multiFace = true;
        detMultiMode.classList.add('active'); detSingleMode.classList.remove('active');
        if (faceMeshInstance) faceMeshInstance.setOptions({ maxNumFaces: 10 });
    });

    detUploadRefBtn.addEventListener('click', uploadRef);
    detAnalyzeRefBtn.addEventListener('click', analyzeRef);
    detClearRefBtn.addEventListener('click', clearRef);
    window.addEventListener('reference-updated', loadSavedRef);

    // ─── Init ──────────────────────────────────────────────
    initMediaPipe();
    enumCameras();
    loadSavedRef();
})();
