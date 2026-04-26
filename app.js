/* =========================================================
   Clonemax — Face Reference Input Module
   Application Logic: Face Detection, Validation & Analysis
   ========================================================= */

(() => {
    'use strict';

    // ─── DOM References ────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const uploadArea     = $('#uploadArea');
    const fileInput      = $('#fileInput');
    const previewWrapper = $('#previewWrapper');
    const previewContainer = $('#previewContainer');
    const previewImage   = $('#previewImage');
    const landmarksCanvas = $('#landmarksCanvas');
    const loadingOverlay = $('#loadingOverlay');
    const loaderText     = $('#loaderText');
    const validationResults = $('#validationResults');
    const emptyState     = $('#emptyState');
    const metricsPanel   = $('#metricsPanel');
    const metricsGrid    = $('#metricsGrid');
    const detailCard     = $('#detailCard');
    const detailBody     = $('#detailBody');
    const resetBtn       = $('#resetBtn');
    const reanalyzeBtn   = $('#reanalyzeBtn');
    const modelStatusEl  = $('#modelStatus');

    // ─── State ─────────────────────────────────────────────
    let modelsLoaded   = false;
    let currentFile    = null;
    let lastDetection  = null;

    // ─── Constants ─────────────────────────────────────────
    const MAX_FILE_SIZE  = 10 * 1024 * 1024; // 10 MB
    const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];
    const MODEL_URL      = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

    // ─── Model Loading ─────────────────────────────────────
    async function loadModels() {
        setModelStatus('loading', 'Loading AI Models…');
        setLoaderState(true, 'Downloading face detection models…');

        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
                faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL),
            ]);

            modelsLoaded = true;
            setModelStatus('ready', 'Models Ready');
            setLoaderState(false);
            showEmptyState('Upload an image to begin face validation…');
        } catch (err) {
            console.error('Model loading failed:', err);
            setModelStatus('error', 'Model Load Failed');
            setLoaderState(false);
            showError('Failed to load AI models. Please check your internet connection and reload.');
        }
    }

    // ─── Helpers: UI State ─────────────────────────────────
    function setModelStatus(state, label) {
        const dot = modelStatusEl.querySelector('.status-dot');
        const lbl = modelStatusEl.querySelector('.status-label');
        dot.className = 'status-dot ' + state;
        lbl.textContent = label;
    }

    function setLoaderState(visible, text) {
        loadingOverlay.style.display = visible ? 'flex' : 'none';
        if (text) loaderText.textContent = text;
    }

    function showEmptyState(msg) {
        validationResults.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <p>${msg}</p>
            </div>`;
    }

    function showError(msg) {
        validationResults.innerHTML = `<div class="status-item error overall">❌ ${msg}</div>`;
    }

    // ─── File Validation ───────────────────────────────────
    function validateFile(file) {
        if (!file) return 'No file selected.';
        if (!ACCEPTED_TYPES.includes(file.type)) return `Unsupported format (${file.type}). Use JPG, PNG, WEBP, or BMP.`;
        if (file.size > MAX_FILE_SIZE) return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`;
        return null;
    }

    // ─── Image Processing Pipeline ─────────────────────────
    async function processImage(file) {
        if (!modelsLoaded) {
            showError('AI models are still loading. Please wait…');
            return;
        }

        const fileError = validateFile(file);
        if (fileError) {
            showError(fileError);
            return;
        }

        currentFile = file;

        // Show preview
        const dataUrl = await readFileAsDataURL(file);
        previewImage.src = dataUrl;

        await new Promise((resolve) => {
            previewImage.onload = resolve;
        });

        uploadArea.style.display = 'none';
        previewWrapper.style.display = 'block';

        // Analyze
        await analyzeFace(previewImage);
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ─── Face Analysis ─────────────────────────────────────
    async function analyzeFace(imgEl) {
        setLoaderState(true, 'Detecting face & extracting landmarks…');
        validationResults.innerHTML = '';
        metricsPanel.style.display = 'none';
        detailCard.style.display = 'none';

        try {
            const detections = await faceapi
                .detectAllFaces(imgEl)
                .withFaceLandmarks()
                .withFaceDescriptors()
                .withAgeAndGender();

            setLoaderState(false);

            if (!detections || detections.length === 0) {
                showError('No face detected. Please upload a clear, well-lit frontal face photo.');
                clearCanvas();
                return;
            }

            // Pick largest face
            const mainFace = detections.reduce((a, b) => {
                const areaA = a.detection.box.width * a.detection.box.height;
                const areaB = b.detection.box.width * b.detection.box.height;
                return areaB > areaA ? b : a;
            });

            lastDetection = mainFace;

            // Multi-face warning
            let multiFaceWarning = null;
            if (detections.length > 1) {
                multiFaceWarning = `${detections.length} faces detected — using the largest one as reference.`;
            }

            // Run quality checks
            const quality = runQualityChecks(mainFace, imgEl);

            // Render UI
            renderValidation(quality, mainFace, multiFaceWarning);
            renderMetrics(quality.metrics);
            renderDetailPanel(mainFace, quality);
            drawLandmarksOnCanvas(mainFace, imgEl);

        } catch (err) {
            console.error('Analysis error:', err);
            setLoaderState(false);
            showError('Error analysing image. Try a different photo.');
        }
    }

    // ─── Quality Checks ────────────────────────────────────
    function runQualityChecks(detection, imgEl) {
        const result = { passed: true, checks: [], metrics: {} };
        const { box } = detection.detection;
        const landmarks = detection.landmarks;
        const imgW = imgEl.naturalWidth || imgEl.width;
        const imgH = imgEl.naturalHeight || imgEl.height;

        // 1. Face Size
        const faceW = Math.round(box.width);
        const faceH = Math.round(box.height);
        result.metrics.faceSize = `${faceW} × ${faceH} px`;
        if (faceW < 100 || faceH < 100) {
            result.checks.push({ name: 'Face Size', status: 'error', msg: `Too small (${faceW}×${faceH}). Min 100×100 px.` });
            result.passed = false;
        } else if (faceW < 200 || faceH < 200) {
            result.checks.push({ name: 'Face Size', status: 'warning', msg: `Small (${faceW}×${faceH}). Larger is better.` });
        } else {
            result.checks.push({ name: 'Face Size', status: 'success', msg: `Good (${faceW}×${faceH})` });
        }

        // 2. Centering
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const offX = Math.abs(cx - imgW / 2) / imgW;
        const offY = Math.abs(cy - imgH / 2) / imgH;
        result.metrics.position = `${Math.round(offX * 100)}% H, ${Math.round(offY * 100)}% V`;
        if (offX > 0.3 || offY > 0.3) {
            result.checks.push({ name: 'Centering', status: 'warning', msg: 'Face is off-center. Center it for best results.' });
        } else {
            result.checks.push({ name: 'Centering', status: 'success', msg: 'Well centred.' });
        }

        // 3. Head Tilt (rotation)
        const leftEye  = centroid(landmarks.getLeftEye());
        const rightEye = centroid(landmarks.getRightEye());
        const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);
        result.metrics.rotation = `${Math.abs(angle).toFixed(1)}°`;
        if (Math.abs(angle) > 15) {
            result.checks.push({ name: 'Head Tilt', status: 'warning', msg: `Tilted ${Math.abs(angle).toFixed(1)}°. Keep head straight.` });
        } else {
            result.checks.push({ name: 'Head Tilt', status: 'success', msg: `Good alignment (${Math.abs(angle).toFixed(1)}°)` });
        }

        // 4. Confidence
        const conf = detection.detection.score;
        result.metrics.confidence = `${(conf * 100).toFixed(1)}%`;
        if (conf < 0.7) {
            result.checks.push({ name: 'Confidence', status: 'error', msg: `Low (${(conf * 100).toFixed(1)}%). Poor quality.` });
            result.passed = false;
        } else if (conf < 0.85) {
            result.checks.push({ name: 'Confidence', status: 'warning', msg: `Medium (${(conf * 100).toFixed(1)}%). Acceptable.` });
        } else {
            result.checks.push({ name: 'Confidence', status: 'success', msg: `High (${(conf * 100).toFixed(1)}%)` });
        }

        // 5. Aspect Ratio
        const ar = box.height / box.width;
        result.metrics.aspectRatio = ar.toFixed(2);
        if (ar < 0.5 || ar > 1.5) {
            result.checks.push({ name: 'Proportions', status: 'warning', msg: 'Unusual aspect ratio. Image may be distorted.' });
        } else {
            result.checks.push({ name: 'Proportions', status: 'success', msg: 'Normal face proportions.' });
        }

        // 6. Image resolution
        result.metrics.imageRes = `${imgW} × ${imgH} px`;
        if (imgW < 200 || imgH < 200) {
            result.checks.push({ name: 'Resolution', status: 'warning', msg: `Image resolution is low (${imgW}×${imgH}).` });
        } else {
            result.checks.push({ name: 'Resolution', status: 'success', msg: `Good resolution (${imgW}×${imgH}).` });
        }

        return result;
    }

    function centroid(points) {
        const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: s.x / points.length, y: s.y / points.length };
    }

    // ─── Render: Validation Results ────────────────────────
    function renderValidation(quality, detection, multiFaceWarning) {
        let html = '';

        // Overall badge
        if (quality.passed) {
            html += `<div class="status-item success overall">✅ VALIDATION PASSED — Ready for face cloning</div>`;
        } else {
            html += `<div class="status-item error overall">❌ VALIDATION FAILED — Use a better quality image</div>`;
        }

        // Multi-face warning
        if (multiFaceWarning) {
            html += `<div class="status-item warning">⚠️ <span class="check-name">Multi-Face</span><span class="check-msg">${multiFaceWarning}</span></div>`;
        }

        // Individual checks
        quality.checks.forEach((c) => {
            const icon = c.status === 'success' ? '✅' : c.status === 'warning' ? '⚠️' : '❌';
            html += `<div class="status-item ${c.status}">${icon} <span class="check-name">${c.name}</span><span class="check-msg">${c.msg}</span></div>`;
        });

        // Age & Gender
        if (detection.age != null && detection.gender) {
            const genderIcon = detection.gender === 'male' ? '👨' : '👩';
            const genderConf = (detection.genderProbability * 100).toFixed(0);
            html += `<div class="status-item success">📊 <span class="check-name">Demographics</span><span class="check-msg">${genderIcon} ${capitalize(detection.gender)} (${genderConf}%) · ~${Math.round(detection.age)} years</span></div>`;
        }

        validationResults.innerHTML = html;
    }

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // ─── Render: Metrics Grid ──────────────────────────────
    function renderMetrics(metrics) {
        metricsPanel.style.display = 'block';
        metricsGrid.innerHTML = '';

        const labels = {
            faceSize:    'Face Size',
            position:    'Offset',
            rotation:    'Tilt Angle',
            confidence:  'Confidence',
            aspectRatio: 'Aspect Ratio',
            imageRes:    'Image Res',
        };

        for (const [key, value] of Object.entries(metrics)) {
            const label = labels[key] || key;
            metricsGrid.innerHTML += `
                <div class="metric-card">
                    <div class="metric-label">${label}</div>
                    <div class="metric-value">${value}</div>
                </div>`;
        }
    }

    // ─── Render: Detail Panel ──────────────────────────────
    function renderDetailPanel(detection, quality) {
        detailCard.style.display = 'block';
        const { box } = detection.detection;
        const lm = detection.landmarks;

        detailBody.innerHTML = `
            <div class="detail-block">
                <h4>🎯 Detection Info</h4>
                <ul>
                    <li>Bounding box: (${Math.round(box.x)}, ${Math.round(box.y)}) → ${Math.round(box.width)}×${Math.round(box.height)}</li>
                    <li>Confidence: ${(detection.detection.score * 100).toFixed(1)}%</li>
                    <li>Descriptor size: ${detection.descriptor.length} float values</li>
                </ul>
                <div class="confidence-bar-track">
                    <div class="confidence-bar-fill ${detection.detection.score >= 0.85 ? 'high' : detection.detection.score >= 0.7 ? 'medium' : 'low'}" style="width: ${(detection.detection.score * 100).toFixed(0)}%"></div>
                </div>
            </div>
            <div class="detail-block">
                <h4>📍 Landmarks</h4>
                <ul>
                    <li>Total points: ${lm.positions.length}</li>
                    <li>Eyes: ${lm.getLeftEye().length + lm.getRightEye().length} points</li>
                    <li>Nose: ${lm.getNose().length} points</li>
                    <li>Mouth: ${lm.getMouth().length} points</li>
                    <li>Jawline: ${lm.getJawOutline().length} points</li>
                    <li>Eyebrows: ${lm.getLeftEyeBrow().length + lm.getRightEyeBrow().length} points</li>
                </ul>
            </div>
            <div class="detail-block">
                <h4>💡 Recommendations</h4>
                <ul>
                    ${quality.passed
                        ? '<li>Face is ready for cloning pipeline</li><li>Good detection quality</li><li>Landmarks extracted successfully</li>'
                        : '<li>Use a frontal face photo</li><li>Ensure good, even lighting</li><li>Face should be at least 200×200 px</li><li>Keep head straight, avoid tilting</li>'
                    }
                </ul>
            </div>`;
    }

    // ─── Canvas: Landmark Drawing ──────────────────────────
    function drawLandmarksOnCanvas(detection, imgEl) {
        const { box } = detection.detection;
        const landmarks = detection.landmarks;

        // Match canvas to the displayed image size
        const rect = imgEl.getBoundingClientRect();
        const dispW = imgEl.clientWidth;
        const dispH = imgEl.clientHeight;
        const natW  = imgEl.naturalWidth;
        const natH  = imgEl.naturalHeight;

        landmarksCanvas.width  = natW;
        landmarksCanvas.height = natH;
        landmarksCanvas.style.width  = dispW + 'px';
        landmarksCanvas.style.height = dispH + 'px';

        const ctx = landmarksCanvas.getContext('2d');
        ctx.clearRect(0, 0, natW, natH);

        // Bounding box
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth   = Math.max(2, natW * 0.004);
        ctx.setLineDash([8, 4]);
        roundRect(ctx, box.x, box.y, box.width, box.height, 8);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = `bold ${Math.max(14, natW * 0.025)}px Inter, sans-serif`;
        ctx.fillStyle = '#34d399';
        ctx.fillText('Reference Face', box.x + 4, box.y - 8);

        // All landmark dots
        const pts = landmarks.positions;
        const dotR = Math.max(2, natW * 0.004);
        ctx.fillStyle = 'rgba(248, 113, 113, 0.85)';
        pts.forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
            ctx.fill();
        });

        // Connect landmark groups
        const groups = [
            { pts: landmarks.getLeftEye(),      color: '#818cf8' },
            { pts: landmarks.getRightEye(),     color: '#818cf8' },
            { pts: landmarks.getLeftEyeBrow(),  color: '#c084fc' },
            { pts: landmarks.getRightEyeBrow(), color: '#c084fc' },
            { pts: landmarks.getNose(),         color: '#fbbf24' },
            { pts: landmarks.getMouth(),        color: '#f87171' },
            { pts: landmarks.getJawOutline(),   color: '#34d399' },
        ];

        groups.forEach(({ pts: gPts, color }) => {
            if (gPts.length < 2) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.5, natW * 0.003);
            ctx.beginPath();
            ctx.moveTo(gPts[0].x, gPts[0].y);
            for (let i = 1; i < gPts.length; i++) {
                ctx.lineTo(gPts[i].x, gPts[i].y);
            }
            ctx.stroke();
        });

        // Feature centre dots (larger)
        const features = [
            landmarks.getLeftEye(),
            landmarks.getRightEye(),
            landmarks.getNose(),
            landmarks.getMouth(),
        ];
        const featureColors = ['#818cf8', '#818cf8', '#fbbf24', '#f87171'];
        features.forEach((f, i) => {
            const c = centroid(f);
            ctx.fillStyle = featureColors[i];
            ctx.beginPath();
            ctx.arc(c.x, c.y, dotR * 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        });
    }

    function roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function clearCanvas() {
        const ctx = landmarksCanvas.getContext('2d');
        ctx.clearRect(0, 0, landmarksCanvas.width, landmarksCanvas.height);
    }

    // ─── Reset ─────────────────────────────────────────────
    function resetAll() {
        currentFile = null;
        lastDetection = null;
        previewImage.src = '';
        previewWrapper.style.display = 'none';
        uploadArea.style.display = '';
        metricsPanel.style.display = 'none';
        detailCard.style.display = 'none';
        fileInput.value = '';
        clearCanvas();
        showEmptyState('Upload an image to begin face validation…');
    }

    // ─── Event Listeners ───────────────────────────────────
    // Click-to-upload
    uploadArea.addEventListener('click', () => fileInput.click());

    // File selected
    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            processImage(e.target.files[0]);
        }
    });

    // Drag & Drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) processImage(file);
    });

    // Keyboard accessibility
    uploadArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    });

    // Reset button
    resetBtn.addEventListener('click', resetAll);

    // Re-analyze button
    reanalyzeBtn.addEventListener('click', () => {
        if (previewImage.src && previewImage.complete) {
            analyzeFace(previewImage);
        }
    });

    // "Use as Reference" button
    const useAsRefBtn = $('#useAsRefBtn');
    if (useAsRefBtn) {
        useAsRefBtn.addEventListener('click', () => {
            if (!previewImage.src || !previewImage.complete) return;
            // Save to localStorage for camera module
            try {
                const canvas = document.createElement('canvas');
                canvas.width = previewImage.naturalWidth;
                canvas.height = previewImage.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(previewImage, 0, 0);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                localStorage.setItem('clonemax_reference', dataUrl);
                // Notify camera module
                window.dispatchEvent(new CustomEvent('reference-updated'));
                useAsRefBtn.textContent = '✅ Saved as Reference!';
                setTimeout(() => { useAsRefBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8h8M8 4v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Use as Reference'; }, 2000);
            } catch (e) {
                console.warn('Could not save reference:', e);
            }
        });
    }

    // ─── Tab Navigation ────────────────────────────────────
    const tabBtns = document.querySelectorAll('.tab-btn');
    const modulePanels = document.querySelectorAll('.module-panel');

    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.module;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            modulePanels.forEach(p => {
                p.classList.toggle('active', p.id === 'module' + capitalize(target));
            });
        });
    });

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // ─── Expose shared state ───────────────────────────────
    window.CloneMax = window.CloneMax || {};
    window.CloneMax.modelsLoaded = () => modelsLoaded;

    // ─── Init ──────────────────────────────────────────────
    loadModels();
})();
