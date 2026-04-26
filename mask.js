/* =========================================================
   Clonemax — Mask Options Module
   Real-time mouth mask generation and overlay
   ========================================================= */
(() => {
    'use strict';
    const $ = s => document.querySelector(s);

    // DOM
    const liveCanvas = $('#maskLiveCanvas');
    const liveCtx = liveCanvas.getContext('2d');
    const placeholder = $('#maskPlaceholder');
    
    const toggleMaskBtn = $('#maskToggleBtn');
    const toggleBoxBtn = $('#maskBoxBtn');
    const alphaSlider = $('#maskAlpha');
    const alphaVal = $('#maskAlphaVal');
    const smoothSlider = $('#maskSmooth');
    const smoothVal = $('#maskSmoothVal');
    const sensSlider = $('#maskSens');
    const sensVal = $('#maskSensVal');
    
    const styleMode = $('#maskStyleMode');
    const colorMode = $('#maskColorMode');
    const customColor = $('#maskCustomColor');
    
    const faceCountEl = $('#maskFaceCount');
    const statusVal = $('#maskStatusVal');
    const fpsEl = $('#maskFps');
    const perfBadge = $('#maskPerfBadge');
    
    const previewMouth = $('#maskPreviewMouth');
    const previewMouthCtx = previewMouth.getContext('2d');
    const previewEffect = $('#maskPreviewEffect');
    const previewEffectCtx = previewEffect.getContext('2d');

    // State
    let video = null, mpCam = null, faceMesh = null;
    let isMaskActive = false;
    let isBoxActive = false;
    let frameCount = 0;
    let lastFpsTs = 0;

    const MOUTH_IDX = [61,146,91,181,84,17,314,405,320,307,375,321,308,324,318,402,317,14,87,178,88,95];

    const COLORS = {
        red: {r:239, g:68, b:64},
        blue: {r:59, g:130, b:246},
        green: {r:16, g:185, b:129},
        yellow: {r:245, g:158, b:11},
        purple: {r:139, g:92, b:246},
        cyan: {r:6, g:182, b:212},
        white: {r:255, g:255, b:255}
    };

    function hexToRgb(hex) {
        const r=parseInt(hex.slice(1,3),16);
        const g=parseInt(hex.slice(3,5),16);
        const b=parseInt(hex.slice(5,7),16);
        return {r,g,b};
    }

    function getCurrentColor() {
        if(colorMode.value==='custom') return hexToRgb(customColor.value);
        return COLORS[colorMode.value];
    }

    // ─── Drawing ───────────────────────────────────────────

    function applySmoothing(pts, passes) {
        if(passes===0 || pts.length<3) return pts;
        let res = [...pts];
        for(let p=0; p<passes; p++){
            const tmp=[];
            for(let i=0; i<res.length; i++){
                const prv=res[(i-1+res.length)%res.length];
                const cur=res[i];
                const nxt=res[(i+1)%res.length];
                tmp.push({ x:(prv.x+cur.x*2+nxt.x)/4, y:(prv.y+cur.y*2+nxt.y)/4 });
            }
            res=tmp;
        }
        return res;
    }

    function drawMaskShape(ctx, pts, color, style, alpha) {
        if(pts.length<3)return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();

        const a = alpha/100;
        const rgba = `rgba(${color.r},${color.g},${color.b},${a})`;

        if(style==='solid'){
            ctx.fillStyle = rgba;
            ctx.fill();
        } else if(style==='outline'){
            ctx.strokeStyle = rgba;
            ctx.lineWidth = 3;
            ctx.stroke();
        } else if(style==='gradient'){
            // approx bounding box for gradient
            let minY=1e9, maxY=-1e9;
            pts.forEach(p=>{if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;});
            const grad = ctx.createLinearGradient(0, minY, 0, maxY);
            grad.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${a*0.2})`);
            grad.addColorStop(1, rgba);
            ctx.fillStyle = grad;
            ctx.fill();
        } else if(style==='pattern'){
            ctx.save();
            ctx.clip();
            ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${a*0.3})`;
            ctx.fill();
            ctx.strokeStyle = rgba;
            ctx.lineWidth = 2;
            ctx.beginPath();
            let minX=1e9, maxX=-1e9, minY=1e9, maxY=-1e9;
            pts.forEach(p=>{
                if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
                if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
            });
            for(let x=minX-50; x<maxX+50; x+=10){
                ctx.moveTo(x, minY-10);
                ctx.lineTo(x+30, maxY+10);
            }
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawBoundingBox(ctx, pts) {
        let minX=1e9, maxX=-1e9, minY=1e9, maxY=-1e9;
        pts.forEach(p=>{
            if(p.x<minX)minX=p.x; if(p.x>maxX)maxX=p.x;
            if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y;
        });
        const pad=10;
        ctx.strokeStyle='#ef4444';
        ctx.lineWidth=2;
        ctx.setLineDash([6,4]);
        ctx.strokeRect(minX-pad, minY-pad, (maxX-minX)+pad*2, (maxY-minY)+pad*2);
        ctx.setLineDash([]);
    }

    // ─── Previews ──────────────────────────────────────────

    function updatePreviews() {
        const w=160, h=90;
        const pts=[];
        const cx=w/2, cy=h/2;
        for(let a=0; a<Math.PI*2; a+=0.3){
            pts.push({ x:cx+Math.cos(a)*40, y:cy+Math.sin(a)*15 });
        }

        const color = getCurrentColor();
        const style = styleMode.value;
        const alpha = parseInt(alphaSlider.value);
        const sm = parseInt(smoothSlider.value);

        const sPts = applySmoothing(pts, sm);

        // Mouth preview
        previewMouthCtx.clearRect(0,0,w,h);
        previewMouthCtx.fillStyle='#1e1e24';
        previewMouthCtx.fillRect(0,0,w,h);
        drawMaskShape(previewMouthCtx, sPts, color, style, alpha);

        // Effect preview
        previewEffectCtx.clearRect(0,0,w,h);
        previewEffectCtx.fillStyle='#1e1e24';
        previewEffectCtx.fillRect(0,0,w,h);
        
        // fake face
        previewEffectCtx.fillStyle='#4a4a5a';
        previewEffectCtx.beginPath();
        previewEffectCtx.ellipse(cx, cy-10, 50, 70, 0, 0, Math.PI*2);
        previewEffectCtx.fill();

        drawMaskShape(previewEffectCtx, sPts, color, style, alpha);
    }

    // ─── MediaPipe ─────────────────────────────────────────

    function onResults(r) {
        if(!video || !video.videoWidth) return;
        const w=liveCanvas.width, h=liveCanvas.height;

        liveCtx.save();
        liveCtx.translate(w,0);
        liveCtx.scale(-1,1);
        liveCtx.drawImage(video, 0, 0, w, h);

        if(r.multiFaceLandmarks && r.multiFaceLandmarks.length>0){
            faceCountEl.textContent = r.multiFaceLandmarks.length;

            if(isMaskActive){
                const sens = parseInt(sensSlider.value)/100;
                
                r.multiFaceLandmarks.forEach((face, idx)=>{
                    if(idx===0 || Math.random()<sens){ // simple sim for sensitivity multi-face logic
                        let pts = MOUTH_IDX.map(i=>({x:face[i].x*w, y:face[i].y*h}));
                        pts = applySmoothing(pts, parseInt(smoothSlider.value));
                        drawMaskShape(liveCtx, pts, getCurrentColor(), styleMode.value, parseInt(alphaSlider.value));
                        if(isBoxActive) drawBoundingBox(liveCtx, pts);
                    }
                });
            }
        } else {
            faceCountEl.textContent = '0';
        }

        liveCtx.restore();

        // FPS
        frameCount++;
        const now=performance.now();
        if(now-lastFpsTs>=1000){
            fpsEl.textContent=frameCount;
            frameCount=0; lastFpsTs=now;
        }
    }

    async function initCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({video:true});
            video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            await video.play();

            liveCanvas.width = video.videoWidth || 640;
            liveCanvas.height = video.videoHeight || 480;
            
            placeholder.style.display='none';
            perfBadge.textContent='⚡ Ready';
            perfBadge.style.display='block';

            faceMesh = new FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});
            faceMesh.setOptions({maxNumFaces:4, refineLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5});
            faceMesh.onResults(onResults);

            mpCam = new Camera(video, {
                onFrame: async()=>{ await faceMesh.send({image:video}); },
                width: liveCanvas.width, height: liveCanvas.height
            });
            mpCam.start();

        } catch(e) {
            console.error(e);
            placeholder.innerHTML='<p>Camera Error</p>';
        }
    }

    // ─── UI Listeners ──────────────────────────────────────

    toggleMaskBtn.addEventListener('click', ()=>{
        isMaskActive = !isMaskActive;
        toggleMaskBtn.textContent = isMaskActive ? '✅ Mask Enabled' : '🔴 Mask Disabled';
        toggleMaskBtn.style.background = isMaskActive ? 'var(--success)' : 'transparent';
        toggleMaskBtn.style.color = isMaskActive ? '#000' : 'white';
        
        statusVal.textContent = isMaskActive ? 'Active' : 'Inactive';
        statusVal.style.color = isMaskActive ? 'var(--success)' : 'var(--error)';
    });

    toggleBoxBtn.addEventListener('click', ()=>{
        isBoxActive = !isBoxActive;
        toggleBoxBtn.textContent = isBoxActive ? '✅ Box Visible' : '🔴 Box Hidden';
        toggleBoxBtn.style.background = isBoxActive ? 'var(--accent-primary)' : 'transparent';
        toggleBoxBtn.style.color = isBoxActive ? '#fff' : 'white';
    });

    alphaSlider.addEventListener('input', ()=>{ alphaVal.textContent=alphaSlider.value+'%'; updatePreviews(); });
    smoothSlider.addEventListener('input', ()=>{ smoothVal.textContent=smoothSlider.value+'px'; updatePreviews(); });
    sensSlider.addEventListener('input', ()=>{ sensVal.textContent=sensSlider.value+'%'; });

    styleMode.addEventListener('change', updatePreviews);
    colorMode.addEventListener('change', ()=>{
        customColor.style.display = colorMode.value==='custom'?'inline-block':'none';
        updatePreviews();
    });
    customColor.addEventListener('input', updatePreviews);

    // Init
    initCamera();
    updatePreviews();
})();
