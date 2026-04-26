/* =========================================================
   Clonemax — Audio Handling Module
   Web Audio API, Visualizer, MIC preservation, and Recording
   ========================================================= */
(() => {
    'use strict';
    const $ = s => document.querySelector(s);

    // DOM
    const toggleBtn = $('#audioToggleBtn');
    const micSelect = $('#audioMicSelect');
    const volSlider = $('#audioVolumeSlider');
    const volVal = $('#audioVolumeVal');
    const noiseSupp = $('#audioNoiseSupp');
    const qualitySel = $('#audioQualityMode');
    const echoBtn = $('#audioEchoBtn');

    const statusVal = $('#audioStatusVal');
    const canvas = $('#audioVisualizerCanvas');
    const ctx = canvas.getContext('2d');
    const levelFill = $('#audioLevelFill');

    const recStartBtn = $('#audioRecordStartBtn');
    const recStopBtn = $('#audioRecordStopBtn');
    const playBtn = $('#audioPlaybackBtn');
    const badge = $('#audioBadgeIndicator');

    const statLvl = $('#statAudioLevel');
    const statRate = $('#statSampleRate');
    const statBuf = $('#statBufferSize');
    const statLat = $('#statLatency');
    const statRec = $('#statRecTime');
    const statFrames = $('#statAudioFrames');

    // State
    let audioCtx = null;
    let stream = null;
    let sourceNode = null;
    let gainNode = null;
    let analyserNode = null;
    
    let isAudioActive = false;
    let isEchoOff = true; // mapped to false echoCancellation by default
    let animId = null;

    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecording = false;
    let recStartTime = 0;
    let recDuration = 0;
    let audioUrl = null;

    let framesProcessed = 0;
    let currentDb = -60;

    // ─── Core Audio Engine ─────────────────────────────────

    async function initAudio() {
        if(!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if(audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        await populateMics();
    }

    async function populateMics() {
        try {
            await navigator.mediaDevices.getUserMedia({audio:true}); // trigger perm
            const devs = await navigator.mediaDevices.enumerateDevices();
            const mics = devs.filter(d=>d.kind==='audioinput');
            micSelect.innerHTML = '<option value="">Default Microphone</option>';
            mics.forEach(m=>{
                const opt = document.createElement('option');
                opt.value = m.deviceId;
                opt.textContent = m.label || `Mic ${micSelect.options.length}`;
                micSelect.appendChild(opt);
            });
        } catch(e) {
            micSelect.innerHTML = '<option value="">Permission Denied</option>';
        }
    }

    function getConstraints() {
        let sr = 16000;
        if(qualitySel.value==='low') sr=8000;
        if(qualitySel.value==='high') sr=44100;
        if(qualitySel.value==='studio') sr=48000;

        const c = {
            audio: {
                echoCancellation: !isEchoOff,
                noiseSuppression: noiseSupp.value !== 'none',
                autoGainControl: true,
                sampleRate: sr
            }
        };
        if(micSelect.value) c.audio.deviceId = { exact: micSelect.value };
        
        if(noiseSupp.value === 'aggressive') {
            c.audio.noiseSuppression = {exact: true};
        }
        return c;
    }

    async function startAudio() {
        await initAudio();
        stopAudio(true); // cleanup but keep intent

        try {
            stream = await navigator.mediaDevices.getUserMedia(getConstraints());
            
            sourceNode = audioCtx.createMediaStreamSource(stream);
            gainNode = audioCtx.createGain();
            analyserNode = audioCtx.createAnalyser();
            
            analyserNode.fftSize = 256;
            analyserNode.smoothingTimeConstant = 0.8;

            gainNode.gain.value = parseInt(volSlider.value)/100;

            sourceNode.connect(gainNode);
            gainNode.connect(analyserNode);
            // Optionally connect to destination if we want to hear ourselves (feedback loop risk)
            // analyserNode.connect(audioCtx.destination);

            isAudioActive = true;
            statusVal.textContent = 'Audio Active';
            statusVal.style.color = 'var(--success)';
            toggleBtn.textContent = '🟢 Audio Enabled';
            toggleBtn.style.background = 'var(--success)';
            toggleBtn.style.color = '#000';
            
            recStartBtn.disabled = false;
            badge.textContent = '⚡ Mic Live';
            badge.style.display = 'block';

            updateVisualizer();

            // Stats
            const track = stream.getAudioTracks()[0];
            const set = track.getSettings();
            statRate.textContent = set.sampleRate || sr;
            statBuf.textContent = analyserNode.frequencyBinCount;
            statLat.textContent = set.latency ? Math.round(set.latency*1000) : 0;

        } catch(e) {
            console.error(e);
            toggleBtn.textContent = '🔴 Failed to Connect';
            setTimeout(()=>toggleBtn.textContent='🔴 Audio Disabled', 2000);
        }
    }

    function stopAudio(isRestart=false) {
        if(animId) { cancelAnimationFrame(animId); animId=null; }
        if(sourceNode) { sourceNode.disconnect(); sourceNode=null; }
        if(analyserNode) { analyserNode.disconnect(); analyserNode=null; }
        if(gainNode) { gainNode.disconnect(); gainNode=null; }
        if(stream) { stream.getTracks().forEach(t=>t.stop()); stream=null; }

        if(!isRestart) {
            isAudioActive = false;
            statusVal.textContent = 'No Audio';
            statusVal.style.color = 'var(--error)';
            toggleBtn.textContent = '🔴 Audio Disabled';
            toggleBtn.style.background = 'transparent';
            toggleBtn.style.color = '#fff';
            recStartBtn.disabled = true;
            levelFill.style.width = '0%';
            badge.style.display = 'none';
            ctx.clearRect(0,0, canvas.width, canvas.height);
            
            if(isRecording) stopRecording();
        }
    }

    function updateVisualizer() {
        if(!isAudioActive || !analyserNode) return;
        
        // fix canvas resolution
        if(canvas.width !== canvas.clientWidth) canvas.width = canvas.clientWidth;
        if(canvas.height !== canvas.clientHeight) canvas.height = canvas.clientHeight;

        const w = canvas.width;
        const h = canvas.height;
        
        const data = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(data);

        ctx.clearRect(0, 0, w, h);
        
        const barW = (w / data.length) * 2.5;
        let x = 0;

        let rms = 0;

        for(let i=0; i<data.length; i++) {
            const v = data[i];
            const barH = (v/255) * h;
            
            ctx.fillStyle = `hsl(${280 - (v/255)*120}, 80%, 60%)`; // gradient purple to cyan/green
            ctx.fillRect(x, h - barH, barW - 1, barH);
            x += barW;

            // map frequency data back to pseudo-time domain for db calc (rough approx)
            const nV = (v-128)/128;
            rms += nV*nV;
        }

        // dB calculation
        rms = Math.sqrt(rms/data.length);
        const db = Math.max(-60, Math.min(0, 20 * Math.log10(rms + 0.0001)));
        currentDb = Math.floor(db + 60); // 0 to 60 scale
        
        levelFill.style.width = `${Math.min(100, (currentDb/60)*100)}%`;
        statLvl.textContent = currentDb;

        framesProcessed++;
        statFrames.textContent = framesProcessed;

        if(isRecording) {
            statRec.textContent = ((Date.now() - recStartTime)/1000).toFixed(1);
        }

        animId = requestAnimationFrame(updateVisualizer);
    }

    // ─── Recording Engine ──────────────────────────────────

    function startRecording() {
        if(!stream) return;
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if(e.data.size>0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, {type:'audio/webm'});
            audioUrl = URL.createObjectURL(blob);
            playBtn.disabled = false;
            recDuration = ((Date.now() - recStartTime)/1000).toFixed(1);
            badge.textContent = `⏹️ Saved (${recDuration}s)`;
        };

        mediaRecorder.start(100);
        isRecording = true;
        recStartTime = Date.now();
        recStartBtn.disabled = true;
        recStopBtn.disabled = false;
        playBtn.disabled = true;
        badge.textContent = '🔴 Recording...';
        badge.style.color = 'var(--error)';
    }

    function stopRecording() {
        if(mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            recStartBtn.disabled = false;
            recStopBtn.disabled = true;
            badge.style.color = 'var(--success)';
        }
    }

    function playAudio() {
        if(audioUrl) {
            const a = new Audio(audioUrl);
            a.play();
            badge.textContent = '▶️ Playing...';
            a.onended = ()=> badge.textContent = '⚡ Mic Live';
        }
    }

    // ─── Events ────────────────────────────────────────────

    toggleBtn.addEventListener('click', ()=>{
        if(isAudioActive) stopAudio();
        else startAudio();
    });

    volSlider.addEventListener('input', ()=>{
        volVal.textContent = volSlider.value+'%';
        if(gainNode) gainNode.gain.value = parseInt(volSlider.value)/100;
    });

    echoBtn.addEventListener('click', ()=>{
        isEchoOff = !isEchoOff;
        echoBtn.textContent = isEchoOff ? '🔴 Echo Cancellation Off' : '🟢 Echo Cancellation On';
        echoBtn.style.background = isEchoOff ? 'transparent' : 'var(--success)';
        echoBtn.style.color = isEchoOff ? '#fff' : '#000';
        if(isAudioActive) startAudio(); // requires restart to apply constraints
    });

    noiseSupp.addEventListener('change', ()=> { if(isAudioActive) startAudio(); });
    qualitySel.addEventListener('change', ()=> { if(isAudioActive) startAudio(); });
    micSelect.addEventListener('change', ()=> { if(isAudioActive) startAudio(); });

    recStartBtn.addEventListener('click', startRecording);
    recStopBtn.addEventListener('click', stopRecording);
    playBtn.addEventListener('click', playAudio);

})();
