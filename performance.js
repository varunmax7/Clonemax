/* =========================================================
   Clonemax — Performance Controls Module
   Frame timing controller, buffer management, & dashboard
   ========================================================= */
(() => {
    'use strict';
    const $ = s => document.querySelector(s);

    // Engine Core
    class PerformanceController {
        constructor() {
            this.targetFps = 30;
            this.frameInterval = 1000 / 30;
            this.bufferSize = 10;
            this.dropStrategy = 'smart';
            this.perfMode = 'balanced';
            
            this.buffer = [];
            this.totalFrames = 0;
            this.processedFrames = 0;
            this.droppedFrames = 0;
            
            this.lastFrameTs = 0;
            this.lastFpsTs = 0;
            this.frameTimes = [];
            this.fpsHistory = [];
            this.cpuHistory = [];
            
            this.currentFps = 0;
            this.avgFps = 0;
            
            this.showOverlay = false;
        }

        setConfig(fps, size, strat, mode) {
            this.targetFps = fps;
            this.frameInterval = fps > 0 ? 1000/fps : 0;
            this.bufferSize = size;
            this.dropStrategy = strat;
            this.perfMode = mode;
            this.trimBuffer();
        }

        addFrame(imgData) {
            this.totalFrames++;
            const q = Math.random() * 50 + (imgData?50:0); // mock quality score

            if (this.buffer.length >= this.bufferSize) this.dropFrame();

            this.buffer.push({ id: this.totalFrames, data: imgData, q });
            return this.buffer[this.buffer.length-1];
        }

        dropFrame() {
            this.droppedFrames++;
            if (this.dropStrategy === 'oldest') {
                this.buffer.shift();
            } else if (this.dropStrategy === 'newest') {
                this.buffer.pop();
            } else if (this.dropStrategy === 'uniform') {
                if (this.buffer.length % 2 === 0) this.buffer.shift();
                else this.buffer.pop();
            } else { // smart
                let minI=0;
                for(let i=1; i<this.buffer.length; i++) {
                    if(this.buffer[i].q < this.buffer[minI].q) minI=i;
                }
                this.buffer.splice(minI, 1);
            }
        }

        getNext() {
            if(this.buffer.length===0) return null;
            this.processedFrames++;
            if (this.dropStrategy==='newest') return this.buffer.pop();
            return this.buffer.shift();
        }

        trimBuffer() {
            while(this.buffer.length > this.bufferSize) this.dropFrame();
        }

        recordFrame(ts) {
            if(this.lastFrameTs>0) this.frameTimes.push(ts - this.lastFrameTs);
            this.lastFrameTs = ts;
        }

        reset() {
            this.buffer=[];
            this.totalFrames=this.processedFrames=this.droppedFrames=0;
            this.lastFrameTs=this.lastFpsTs=0;
            this.frameTimes=[]; this.fpsHistory=[]; this.cpuHistory=[];
            this.currentFps=this.avgFps=0;
        }
    }

    // DOM Links
    const liveCanvas = $('#perfLiveCanvas');
    const liveCtx = liveCanvas.getContext('2d');
    const placeholder = $('#perfPlaceholder');
    const startBtn = $('#perfStartBtn');
    const stopBtn = $('#perfStopBtn');
    const resetBtn = $('#perfResetBtn');
    const targetFpsSel = $('#perfTargetFps');
    const perfModeSel = $('#perfMode');
    const bufSizeSlider = $('#perfBufferSize');
    const bufSizeVal = $('#perfBufferSizeVal');
    const dropStratSel = $('#perfDropStrategy');
    const overlayBtn = $('#perfToggleOverlayBtn');
    const badge = $('#perfBadgeIndicator');

    const statVals = {
        fps: $('#valCurrentFps'), avg: $('#valAvgFps'),
        time: $('#valFrameTime'), drop: $('#valDropped'),
        buf: $('#valBufferUsage'), proc: $('#valProcessed'),
        cpu: $('#valCpuLoad'), lat: $('#valLatency')
    };
    const statTrends = {
        fps: $('#trendCurrentFps'), avg: $('#trendAvgFps'),
        time: $('#trendFrameTime'), drop: $('#trendDropped'),
        buf: $('#trendBufferUsage'), proc: $('#trendProcessed'),
        cpu: $('#trendCpuLoad'), lat: $('#trendLatency')
    };

    const fpsGraph = $('#perfFpsGraph');
    const bufSlots = $('#perfBufferSlots');

    // App State
    let stream=null, video=null;
    let animId=null;
    const engine = new PerformanceController();
    let prevStats = {};

    function updateTrends(stats) {
        if(prevStats.fps!==undefined) {
            const dFps = stats.fps - prevStats.fps;
            statTrends.fps.textContent = dFps>0?`↑ +${dFps}` : dFps<0?`↓ ${dFps}`:`→ 0`;
            statTrends.fps.className = `trend ${dFps>0?'trend-up':dFps<0?'trend-down':'trend-stable'}`;

            const dTime = stats.time - prevStats.time;
            statTrends.time.textContent = dTime<0?`↓ ${Math.abs(dTime).toFixed(1)}` : dTime>0?`↑ +${dTime.toFixed(1)}`:`→ 0`;
            statTrends.time.className = `trend ${dTime<0?'trend-up':dTime>0?'trend-down':'trend-stable'}`;
        }
        prevStats = {...stats};
    }

    function renderDashboard(now) {
        if(now - engine.lastFpsTs >= 1000) {
            engine.currentFps = engine.frameTimes.length;
            engine.fpsHistory.push(engine.currentFps);
            if(engine.fpsHistory.length>60) engine.fpsHistory.shift();
            
            engine.avgFps = engine.fpsHistory.reduce((a,b)=>a+b,0)/engine.fpsHistory.length;
            const avgFrameTime = engine.frameTimes.length>0 ? engine.frameTimes.reduce((a,b)=>a+b,0)/engine.frameTimes.length : 16.67;
            
            const dropRate = engine.totalFrames>0 ? (engine.droppedFrames/engine.totalFrames)*100 : 0;
            const targetTime = engine.targetFps>0 ? 1000/engine.targetFps : 16.67;
            const cpu = Math.min(100, (avgFrameTime/targetTime)*100);
            
            engine.cpuHistory.push(cpu);
            if(engine.cpuHistory.length>10) engine.cpuHistory.shift();
            const avgCpu = engine.cpuHistory.reduce((a,b)=>a+b,0)/engine.cpuHistory.length;
            
            const lat = engine.buffer.length * avgFrameTime;
            const procRate = engine.totalFrames>0 ? ((engine.processedFrames/engine.totalFrames)*100).toFixed(1):0;

            const stats = {
                fps: engine.currentFps, avg: engine.avgFps, time: avgFrameTime,
                drop: engine.droppedFrames, dropR: dropRate, buf: engine.buffer.length,
                bufMax: engine.bufferSize, proc: engine.processedFrames, procR: procRate,
                cpu: avgCpu, lat: lat
            };

            // UI
            statVals.fps.textContent = stats.fps;
            statVals.avg.textContent = stats.avg.toFixed(1);
            statVals.time.textContent = stats.time.toFixed(1);
            statVals.drop.textContent = stats.drop;
            statTrends.drop.textContent = `${stats.dropR.toFixed(1)}%`;
            statVals.buf.textContent = stats.buf;
            statTrends.buf.textContent = `${((stats.buf/stats.bufMax)*100).toFixed(0)}%`;
            statVals.proc.textContent = stats.proc;
            statTrends.proc.textContent = `${stats.procR}%`;
            statVals.cpu.textContent = stats.cpu.toFixed(0);
            statVals.lat.textContent = stats.lat.toFixed(0);

            updateTrends(stats);

            // Graph
            const bar = document.createElement('div');
            bar.className = 'perf-fps-bar';
            bar.style.height = `${Math.max(2, (stats.fps/60)*100)}%`;
            fpsGraph.appendChild(bar);
            while(fpsGraph.children.length>50) fpsGraph.removeChild(fpsGraph.firstChild);

            // Buffer Viz
            bufSlots.innerHTML = '';
            for(let i=0; i<engine.bufferSize; i++) {
                const s = document.createElement('div');
                s.className = 'perf-buffer-slot';
                if(i<engine.buffer.length) {
                    s.classList.add('filled');
                    s.textContent = engine.buffer[i].id;
                } else {
                    s.textContent = '○';
                }
                bufSlots.appendChild(s);
            }

            // Badge
            if(stats.fps>=25) badge.style.color='var(--success)';
            else if(stats.fps>=15) badge.style.color='var(--accent-secondary)';
            else badge.style.color='var(--error)';
            badge.textContent = `${stats.fps} FPS | Buf: ${stats.buf}`;

            engine.frameTimes=[];
            engine.lastFpsTs = now;
        }
    }

    // Main Loop
    function loop(ts) {
        if(!stream) return;
        
        const delayReq = engine.frameInterval;
        if(delayReq===0 || (ts - engine.lastFrameTs) >= delayReq) {
            
            // Sim processing load
            let block = 0;
            switch(engine.perfMode) {
                case 'quality': block=15+Math.random()*10; break;
                case 'balanced': block=8+Math.random()*7; break;
                case 'performance': block=3+Math.random()*5; break;
                case 'power_saver': block=1+Math.random()*3; break;
            }
            const t0=performance.now(); while(performance.now()-t0 < block){}

            liveCtx.drawImage(video, 0,0, liveCanvas.width, liveCanvas.height);
            const frame = engine.addFrame(null); // mock data payload
            const out = engine.getNext();

            if(engine.showOverlay && out) {
                liveCtx.fillStyle = 'rgba(0,0,0,0.7)';
                liveCtx.fillRect(10,10, 110,35);
                liveCtx.fillStyle = engine.currentFps>=25?'#00ff88':engine.currentFps>=15?'#ffaa44':'#ff4444';
                liveCtx.font='14px monospace';
                liveCtx.fillText(`${engine.currentFps} FPS`, 15,32);
            }

            engine.recordFrame(ts);
        }

        renderDashboard(ts);
        animId = requestAnimationFrame(loop);
    }

    async function start() {
        if(!video) {
            stream = await navigator.mediaDevices.getUserMedia({video:true});
            video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;
            await video.play();
            liveCanvas.width=video.videoWidth; liveCanvas.height=video.videoHeight;
        }
        placeholder.style.display='none';
        badge.style.display='block';
        startBtn.disabled=true; stopBtn.disabled=false;
        syncEngine();
        animId = requestAnimationFrame(loop);
    }

    function stop() {
        cancelAnimationFrame(animId);
        startBtn.disabled=false; stopBtn.disabled=true;
        badge.textContent='⏸️ Stopped';
    }

    function syncEngine() {
        engine.setConfig(
            parseInt(targetFpsSel.value),
            parseInt(bufSizeSlider.value),
            dropStratSel.value,
            perfModeSel.value
        );
    }

    // Events
    startBtn.onclick = start;
    stopBtn.onclick = stop;
    resetBtn.onclick = ()=>{ engine.reset(); fpsGraph.innerHTML=''; bufSlots.innerHTML=''; };
    
    targetFpsSel.onchange = syncEngine;
    perfModeSel.onchange = ()=>{
        const mode=perfModeSel.value;
        if(mode==='quality'){ targetFpsSel.value='60'; bufSizeSlider.value='20'; }
        if(mode==='balanced'){ targetFpsSel.value='30'; bufSizeSlider.value='10'; }
        if(mode==='performance'){ targetFpsSel.value='24'; bufSizeSlider.value='5'; }
        if(mode==='power_saver'){ targetFpsSel.value='15'; bufSizeSlider.value='3'; }
        bufSizeVal.textContent=bufSizeSlider.value;
        syncEngine();
    };
    bufSizeSlider.oninput = ()=>{ bufSizeVal.textContent=bufSizeSlider.value; syncEngine(); };
    dropStratSel.onchange = syncEngine;
    
    overlayBtn.onclick = ()=>{
        engine.showOverlay = !engine.showOverlay;
        overlayBtn.textContent = engine.showOverlay?'✅ FPS Overlay Visible':'🔴 FPS Overlay Hidden';
        overlayBtn.style.color = engine.showOverlay?'#000':'#fff';
        overlayBtn.style.background = engine.showOverlay?'var(--success)':'transparent';
    };

})();
