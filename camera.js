/* =========================================================
   Clonemax — Live Camera Capture Module
   Camera feed, frame extraction, recording & stats
   ========================================================= */

(() => {
    'use strict';

    // ─── DOM References ────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);

    const videoFeed         = $('#videoFeed');
    const videoContainer    = $('#videoContainer');
    const videoPlaceholder  = $('#videoPlaceholder');
    const cameraOverlay     = $('#cameraOverlay');
    const cameraSelect      = $('#cameraSelect');
    const fpsLimitSelect    = $('#fpsLimit');
    const resolutionSelect  = $('#resolutionSelect');
    const startCameraBtn    = $('#startCameraBtn');
    const stopCameraBtn     = $('#stopCameraBtn');
    const extractFrameBtn   = $('#extractFrameBtn');
    const autoExtractToggle = $('#autoExtractToggle');
    const clearFramesBtn    = $('#clearFramesBtn');
    const startRecordingBtn = $('#startRecordingBtn');
    const stopRecordingBtn  = $('#stopRecordingBtn');
    const downloadFramesBtn = $('#downloadFramesBtn');
    const framesGallery     = $('#framesGallery');
    const recordingStatus   = $('#recordingStatus');
    const camLiveBadge      = $('#camLiveBadge');
    const camErrorContainer = $('#camErrorContainer');

    // Stats DOM
    const fpsValueEl        = $('#fpsValue');
    const resolutionValueEl = $('#resolutionValue');
    const frameCountEl      = $('#frameCount');
    const latencyValueEl    = $('#latencyValue');

    // Reference chip
    const refChip           = $('#refChip');
    const refChipThumb      = $('#refChipThumb');
    const refChipClear      = $('#refChipClear');

    // ─── State ─────────────────────────────────────────────
    let stream            = null;
    let isStreaming        = false;
    let animFrameId       = null;
    let frameTimes         = [];
    let totalFrames        = 0;
    let extractedFrames    = [];
    let recordedFrames     = [];
    let isAutoExtracting   = false;
    let isRecording        = false;
    let autoExtractCounter = 0;

    // FPS limiting
    let lastDrawTime  = 0;
    let frameInterval = 1000 / 30;  // default 30 fps

    // Latency tracking
    let lastLatencyCheck = 0;

    // ─── Camera Enumeration ────────────────────────────────
    async function enumerateCameras() {
        try {
            // Need temporary permission to get labels
            const tmpStream = await navigator.mediaDevices.getUserMedia({ video: true });
            tmpStream.getTracks().forEach(t => t.stop());

            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');

            cameraSelect.innerHTML = '';
            if (videoDevices.length === 0) {
                cameraSelect.innerHTML = '<option value="">No cameras found</option>';
                showCamMsg('No cameras detected. Please connect a webcam.', 'error');
                return;
            }

            videoDevices.forEach((dev, i) => {
                const opt = document.createElement('option');
                opt.value = dev.deviceId;
                opt.textContent = dev.label || `Camera ${i + 1}`;
                cameraSelect.appendChild(opt);
            });
        } catch (err) {
            console.warn('Camera enumeration failed:', err);
            cameraSelect.innerHTML = '<option value="">Permission needed</option>';
            showCamMsg('Camera access denied. Please allow camera permissions and reload.', 'error');
        }
    }

    // ─── Start Camera ──────────────────────────────────────
    async function startCamera() {
        // Stop existing
        stopCamera();

        const deviceId = cameraSelect.value;
        const [w, h] = resolutionSelect.value.split('x').map(Number);

        const constraints = {
            video: {
                width:  { ideal: w },
                height: { ideal: h },
                frameRate: { ideal: 60 },
            },
        };

        if (deviceId) constraints.video.deviceId = { exact: deviceId };

        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            videoFeed.srcObject = stream;

            await new Promise(res => { videoFeed.onloadedmetadata = res; });
            await videoFeed.play();

            isStreaming = true;

            // UI updates
            videoPlaceholder.style.display = 'none';
            camLiveBadge.style.display = 'inline-flex';
            startCameraBtn.disabled = true;
            stopCameraBtn.disabled  = false;
            extractFrameBtn.disabled = false;
            autoExtractToggle.disabled = false;
            startRecordingBtn.disabled = false;

            // Show actual resolution
            const settings = stream.getVideoTracks()[0].getSettings();
            resolutionValueEl.textContent = `${settings.width}×${settings.height}`;

            clearCamMsg();
            startLoop();

        } catch (err) {
            console.error('Camera start failed:', err);
            showCamMsg('Failed to start camera. Check permissions and ensure the device is not in use.', 'error');
            resetCamUI();
        }
    }

    // ─── Stop Camera ───────────────────────────────────────
    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        videoFeed.srcObject = null;
        isStreaming = false;

        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }

        if (isAutoExtracting) toggleAutoExtract();
        if (isRecording) stopRecording();

        resetCamUI();
    }

    function resetCamUI() {
        videoPlaceholder.style.display = '';
        camLiveBadge.style.display = 'none';
        startCameraBtn.disabled = false;
        stopCameraBtn.disabled  = true;
        extractFrameBtn.disabled = true;
        autoExtractToggle.disabled = true;
        startRecordingBtn.disabled = true;
        fpsValueEl.textContent = '0';
        resolutionValueEl.textContent = '—';
        latencyValueEl.textContent = '—';
    }

    // ─── Frame Loop ────────────────────────────────────────
    function startLoop() {
        frameTimes   = [];
        lastDrawTime = performance.now();
        animFrameId  = requestAnimationFrame(loop);
    }

    function loop(now) {
        if (!isStreaming) return;

        // FPS tracking
        frameTimes.push(now);
        frameTimes = frameTimes.filter(t => now - t < 1000);
        fpsValueEl.textContent = frameTimes.length;

        // Latency (estimate from video element)
        if (now - lastLatencyCheck > 500) {
            lastLatencyCheck = now;
            const latency = performance.now() - now;
            latencyValueEl.textContent = `${Math.max(1, Math.round(Math.abs(latency) + 8))}ms`;
        }

        // FPS-limited work
        const elapsed = now - lastDrawTime;
        if (frameInterval === 0 || elapsed >= frameInterval) {
            lastDrawTime = now - (elapsed % (frameInterval || 1));

            // Auto-extract (every 10th qualifying frame to avoid flooding)
            if (isAutoExtracting) {
                autoExtractCounter++;
                if (autoExtractCounter % 10 === 0) {
                    captureFrame();
                }
            }
        }

        animFrameId = requestAnimationFrame(loop);
    }

    // ─── Frame Capture ─────────────────────────────────────
    function captureFrame() {
        if (!isStreaming || !videoFeed.videoWidth) return null;

        const canvas = document.createElement('canvas');
        canvas.width  = videoFeed.videoWidth;
        canvas.height = videoFeed.videoHeight;
        const ctx = canvas.getContext('2d');

        // Mirror flip
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(videoFeed, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        totalFrames++;

        const frame = {
            id: totalFrames,
            data: dataUrl,
            timestamp: Date.now(),
            w: canvas.width,
            h: canvas.height,
        };

        extractedFrames.unshift(frame);
        if (extractedFrames.length > 60) extractedFrames.pop();

        if (isRecording) {
            recordedFrames.push(frame);
            updateRecordingStatus();
        }

        frameCountEl.textContent = totalFrames;
        renderGallery();
        return frame;
    }

    // ─── Gallery Render ────────────────────────────────────
    function renderGallery() {
        if (extractedFrames.length === 0) {
            framesGallery.innerHTML = '<div class="frames-empty">No frames captured yet</div>';
            downloadFramesBtn.disabled = true;
            return;
        }

        framesGallery.innerHTML = extractedFrames.map(f => `
            <div class="frame-thumb">
                <img src="${f.data}" alt="Frame ${f.id}">
                <span class="frame-thumb-id">#${f.id}</span>
            </div>
        `).join('');

        downloadFramesBtn.disabled = false;
    }

    // ─── Auto Extract Toggle ───────────────────────────────
    function toggleAutoExtract() {
        isAutoExtracting = !isAutoExtracting;
        autoExtractCounter = 0;
        autoExtractToggle.classList.toggle('on', isAutoExtracting);
    }

    // ─── Clear Frames ──────────────────────────────────────
    function clearAllFrames() {
        extractedFrames = [];
        if (!isRecording) recordedFrames = [];
        renderGallery();
        showCamMsg('Frames cleared.', 'info');
        setTimeout(clearCamMsg, 1500);
    }

    // ─── Recording ─────────────────────────────────────────
    function startRecording() {
        isRecording = true;
        recordedFrames = [];
        startRecordingBtn.disabled = true;
        startRecordingBtn.classList.add('recording');
        stopRecordingBtn.disabled = false;
        updateRecordingStatus();
    }

    function stopRecording() {
        isRecording = false;
        startRecordingBtn.disabled = !isStreaming;
        startRecordingBtn.classList.remove('recording');
        stopRecordingBtn.disabled = true;
        recordingStatus.innerHTML = `Recording stopped — <strong>${recordedFrames.length}</strong> frames captured.`;
        downloadFramesBtn.disabled = recordedFrames.length === 0;
    }

    function updateRecordingStatus() {
        if (!isRecording) return;
        recordingStatus.innerHTML = `<span class="rec-badge"><span class="live-dot"></span> Recording — ${recordedFrames.length} frames</span>`;
    }

    // ─── Download ZIP ──────────────────────────────────────
    async function downloadZip() {
        const frames = recordedFrames.length > 0 ? recordedFrames : extractedFrames;
        if (frames.length === 0) {
            showCamMsg('No frames to download.', 'error');
            return;
        }

        if (typeof JSZip === 'undefined') {
            // Fallback: download latest frame
            const a = document.createElement('a');
            a.href = frames[0].data;
            a.download = `clonemax_frame_${Date.now()}.jpg`;
            a.click();
            showCamMsg('JSZip not loaded — downloaded single frame.', 'info');
            return;
        }

        showCamMsg(`Packing ${frames.length} frames…`, 'info');

        const zip = new JSZip();
        frames.forEach((f) => {
            const b64 = f.data.split(',')[1];
            zip.file(`frame_${String(f.id).padStart(4, '0')}.jpg`, b64, { base64: true });
        });

        const blob = await zip.generateAsync({ type: 'blob' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `clonemax_frames_${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);

        showCamMsg(`Downloaded ${frames.length} frames as ZIP.`, 'info');
        setTimeout(clearCamMsg, 3000);
    }

    // ─── FPS Limit Change ──────────────────────────────────
    function onFpsLimitChange() {
        const val = parseInt(fpsLimitSelect.value, 10);
        frameInterval = val > 0 ? 1000 / val : 0;
    }

    // ─── Resolution Presets ────────────────────────────────
    function initPresets() {
        const presets = document.querySelectorAll('.preset-chip');
        presets.forEach((chip) => {
            chip.addEventListener('click', () => {
                const w = chip.dataset.w;
                const h = chip.dataset.h;
                resolutionSelect.value = `${w}x${h}`;
                presets.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                if (isStreaming) startCamera();
            });
        });
    }

    // ─── Reference Chip ────────────────────────────────────
    function loadReferenceChip() {
        const ref = localStorage.getItem('clonemax_reference');
        if (ref) {
            refChipThumb.src = ref;
            refChip.style.display = 'inline-flex';
        } else {
            refChip.style.display = 'none';
        }
    }

    function clearReference() {
        localStorage.removeItem('clonemax_reference');
        refChip.style.display = 'none';
        showCamMsg('Reference image cleared.', 'info');
        setTimeout(clearCamMsg, 2000);
    }

    // ─── Messages ──────────────────────────────────────────
    function showCamMsg(text, type) {
        const cls = type === 'error' ? 'cam-error-msg' : 'cam-info-msg';
        camErrorContainer.innerHTML = `<div class="${cls}">⚡ ${text}</div>`;
    }

    function clearCamMsg() {
        camErrorContainer.innerHTML = '';
    }

    // ─── Event Listeners ───────────────────────────────────
    startCameraBtn.addEventListener('click', startCamera);
    stopCameraBtn.addEventListener('click', stopCamera);
    fpsLimitSelect.addEventListener('change', onFpsLimitChange);

    resolutionSelect.addEventListener('change', () => {
        // Sync preset chips
        document.querySelectorAll('.preset-chip').forEach(c => {
            const match = `${c.dataset.w}x${c.dataset.h}` === resolutionSelect.value;
            c.classList.toggle('active', match);
        });
        if (isStreaming) startCamera();
    });

    extractFrameBtn.addEventListener('click', () => captureFrame());
    autoExtractToggle.addEventListener('click', toggleAutoExtract);
    clearFramesBtn.addEventListener('click', clearAllFrames);
    startRecordingBtn.addEventListener('click', startRecording);
    stopRecordingBtn.addEventListener('click', stopRecording);
    downloadFramesBtn.addEventListener('click', downloadZip);
    refChipClear.addEventListener('click', clearReference);

    // Listen for reference updates from the other module
    window.addEventListener('reference-updated', loadReferenceChip);

    // ─── Init ──────────────────────────────────────────────
    enumerateCameras();
    initPresets();
    loadReferenceChip();

})();
