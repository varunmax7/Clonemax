/* =========================================================
   Clonemax — Face Enhancer Engine
   GPEN/GFPGAN simulations, advanced sharpness & color boost
   ========================================================= */
(() => {
    'use strict';
    const $ = s => document.querySelector(s);

    // DOM Elements
    const sourceCanvas = $('#enhSourceCanvas');
    const sourceCtx = sourceCanvas.getContext('2d');
    const outputCanvas = $('#enhOutputCanvas');
    const outputCtx = outputCanvas.getContext('2d');
    
    const enhPlaceholder = $('#enhPlaceholder');
    const enhSourceEmpty = $('#enhSourceEmpty');
    const enhSourceInfo = $('#enhSourceInfo');
    const enhTimeEl = $('#enhTime');
    const enhQualityEl = $('#enhQuality');
    const enhProgress = $('#enhProgress');
    const enhPerfBadge = $('#enhPerfBadge');
    
    // Sliders
    const sharpnessSlider = $('#enhSharpness');
    const sharpnessVal = $('#enhSharpnessVal');
    const denoiseSlider = $('#enhDenoise');
    const denoiseVal = $('#enhDenoiseVal');
    const colorBoostSlider = $('#enhColorBoost');
    const colorBoostVal = $('#enhColorBoostVal');
    
    // Selects
    const enhModel = $('#enhModel');
    const enhRestoration = $('#enhRestoration');
    const enhUpscale = $('#enhUpscale');

    // Compare
    const compareCard = $('#enhCompareCard');
    const compareSrc = $('#enhCompareSourceCanvas');
    const compareTgt = $('#enhCompareTargetCanvas');
    const compareOverlay = $('#enhCompareOverlay');
    const compareHandle = $('#enhCompareHandle');
    
    // State
    let sourceImgData = null;
    let enhancedImgData = null;
    let autoEnhanceInterval = null;

    // ─── Filters & Processors ────────────────────────────────
    
    class SharpnessProcessor {
        static boxBlur(data, w, h, r) {
            const res = new Uint8ClampedArray(data.length);
            const wnd = (r*2+1)**2;
            for(let y=r; y<h-r; y++){
                for(let x=r; x<w-r; x++){
                    let sr=0, sg=0, sb=0;
                    for(let dy=-r; dy<=r; dy++){
                        for(let dx=-r; dx<=r; dx++){
                            const i = ((y+dy)*w + (x+dx))*4;
                            sr+=data[i]; sg+=data[i+1]; sb+=data[i+2];
                        }
                    }
                    const i = (y*w+x)*4;
                    res[i]=sr/wnd; res[i+1]=sg/wnd; res[i+2]=sb/wnd; res[i+3]=data[i+3];
                }
            }
            return res;
        }

        static unsharpMask(imgData, amt, radius=1) {
            const w=imgData.width, h=imgData.height, d=imgData.data;
            const tmp=new Uint8ClampedArray(d);
            const blurred=this.boxBlur(tmp, w, h, radius);
            const a=amt/100;
            for(let i=0; i<d.length; i+=4){
                for(let c=0; c<3; c++){
                    const diff=tmp[i+c]-blurred[i+c];
                    d[i+c]=Math.max(0,Math.min(255,tmp[i+c]+a*diff));
                }
            }
            return imgData;
        }

        static laplacian(imgData, amt) {
            const w=imgData.width, h=imgData.height, d=imgData.data;
            const tmp=new Uint8ClampedArray(d);
            const k=[[0,-1,0],[-1,4,-1],[0,-1,0]];
            const a=amt/100;
            for(let y=1; y<h-1; y++){
                for(let x=1; x<w-1; x++){
                    const i=(y*w+x)*4;
                    for(let c=0; c<3; c++){
                        let l=0;
                        for(let ky=-1; ky<=1; ky++){
                            for(let kx=-1; kx<=1; kx++){
                                l+=tmp[((y+ky)*w+(x+kx))*4+c]*k[ky+1][kx+1];
                            }
                        }
                        d[i+c]=Math.max(0,Math.min(255,tmp[i+c]+a*l));
                    }
                }
            }
            return imgData;
        }

        static highPass(imgData, amt) {
            const w=imgData.width, h=imgData.height, d=imgData.data;
            const tmp=new Uint8ClampedArray(d);
            const k=[[-1,-1,-1],[-1,8,-1],[-1,-1,-1]];
            const a=amt/100;
            for(let y=1; y<h-1; y++){
                for(let x=1; x<w-1; x++){
                    const i=(y*w+x)*4;
                    for(let c=0; c<3; c++){
                        let hp=0;
                        for(let ky=-1; ky<=1; ky++){
                            for(let kx=-1; kx<=1; kx++){
                                hp+=tmp[((y+ky)*w+(x+kx))*4+c]*k[ky+1][kx+1];
                            }
                        }
                        d[i+c]=Math.max(0,Math.min(255,tmp[i+c]+a*(hp/8)));
                    }
                }
            }
            return imgData;
        }
    }

    class DenoiseProcessor {
        static median(imgData, str) {
            const w=imgData.width, h=imgData.height, d=imgData.data;
            const tmp=new Uint8ClampedArray(d);
            const r=Math.floor(str/30)+1;
            for(let y=r; y<h-r; y++){
                for(let x=r; x<w-r; x++){
                    const i=(y*w+x)*4;
                    for(let c=0; c<3; c++){
                        const v=[];
                        for(let ky=-r; ky<=r; ky++){
                            for(let kx=-r; kx<=r; kx++){
                                v.push(tmp[((y+ky)*w+(x+kx))*4+c]);
                            }
                        }
                        v.sort((a,b)=>a-b);
                        d[i+c]=v[Math.floor(v.length/2)];
                    }
                }
            }
            return imgData;
        }
        
        static bilateral(imgData, str) {
            const w=imgData.width, h=imgData.height, d=imgData.data;
            const tmp=new Uint8ClampedArray(d);
            const sigS=str/20, sigR=str/10;
            for(let y=2; y<h-2; y++){
                for(let x=2; x<w-2; x++){
                    const i=(y*w+x)*4;
                    for(let c=0; c<3; c++){
                        let tw=0, tv=0;
                        for(let ky=-2; ky<=2; ky++){
                            for(let kx=-2; kx<=2; kx++){
                                const pi=((y+ky)*w+(x+kx))*4;
                                const sd=kx*kx+ky*ky;
                                const cd=Math.abs(tmp[i+c]-tmp[pi+c]);
                                const wgt=Math.exp(-sd/(2*sigS*sigS))*Math.exp(-(cd*cd)/(2*sigR*sigR));
                                tw+=wgt; tv+=tmp[pi+c]*wgt;
                            }
                        }
                        d[i+c]=tv/tw;
                    }
                }
            }
            return imgData;
        }
    }

    class ColorEnhancer {
        static boost(imgData, amt) {
            const d=imgData.data;
            const b=amt/100;
            for(let i=0; i<d.length; i+=4){
                const r=d[i], g=d[i+1], bb=d[i+2];
                const max=Math.max(r,g,bb), min=Math.min(r,g,bb);
                let sat = max===0?0:(max-min)/max;
                sat = Math.min(1, sat*(1+b));
                if(max>0){
                    d[i]=Math.min(255,r*(1+b*sat));
                    d[i+1]=Math.min(255,g*(1+b*sat));
                    d[i+2]=Math.min(255,bb*(1+b*sat));
                }
            }
            return imgData;
        }
        
        static contrast(imgData, amt) {
            const d=imgData.data;
            const c=amt/50;
            const f=(259*(c+255))/(255*(259-c));
            for(let i=0; i<d.length; i+=4){
                d[i]=Math.max(0,Math.min(255,f*(d[i]-128)+128));
                d[i+1]=Math.max(0,Math.min(255,f*(d[i+1]-128)+128));
                d[i+2]=Math.max(0,Math.min(255,f*(d[i+2]-128)+128));
            }
            return imgData;
        }
    }

    // ─── Simulators ────────────────────────────────────────

    async function upscaleImage(imgData, factor) {
        if(factor===1) return imgData;
        const w=imgData.width*factor, h=imgData.height*factor;
        const c=document.createElement('canvas'); c.width=w; c.height=h;
        const ctx=c.getContext('2d');
        const tc=document.createElement('canvas'); tc.width=imgData.width; tc.height=imgData.height;
        tc.getContext('2d').putImageData(imgData,0,0);
        ctx.imageSmoothingEnabled=true;
        ctx.imageSmoothingQuality='high';
        ctx.drawImage(tc,0,0,w,h);
        return ctx.getImageData(0,0,w,h);
    }

    async function runModelPipeline(imgData, model, restLvl) {
        let res = new ImageData(new Uint8ClampedArray(imgData.data), imgData.width, imgData.height);
        
        // Base restoration multiplier
        const m = restLvl==='light'?0.5 : restLvl==='strong'?1.5 : restLvl==='extreme'?2.0 : 1.0;

        if(model.startsWith('gpen')){
            res = SharpnessProcessor.laplacian(res, 80*m);
            res = DenoiseProcessor.bilateral(res, 60);
            res = ColorEnhancer.boost(res, 40);
        } else if(model==='gfpgan') {
            res = DenoiseProcessor.median(res, 50*m);
            res = SharpnessProcessor.highPass(res, 100*m);
            res = DenoiseProcessor.bilateral(res, 40);
            res = ColorEnhancer.contrast(res, 20);
        } else if(model==='codeformer') {
            res = SharpnessProcessor.laplacian(res, 120*m);
            res = ColorEnhancer.boost(res, 60);
            res = SharpnessProcessor.unsharpMask(res, 100*m, 0.6);
        } else { // real_esrgan
            res = DenoiseProcessor.bilateral(res, 70*m);
            res = SharpnessProcessor.highPass(res, 130*m);
            res = ColorEnhancer.boost(res, 50);
        }
        return res;
    }

    function calcQuality(imgData) {
        const d=imgData.data;
        let lSum=0, min=255, max=0;
        for(let i=4; i<d.length-4; i+=4){
            lSum+=Math.abs(d[i]-d[i-4])+Math.abs(d[i]-d[i+4]);
            const b=(d[i]+d[i+1]+d[i+2])/3;
            if(b<min)min=b; if(b>max)max=b;
        }
        const sScore=Math.min(100, lSum/(d.length/4)/8);
        const cScore=max-min;
        return Math.min(100, Math.floor((sScore+cScore)/2));
    }

    // ─── Engine ────────────────────────────────────────────

    async function processEnhancement() {
        if(!sourceImgData) return;
        
        const t0=performance.now();
        enhPerfBadge.textContent='✨ Enhancing...';
        enhPerfBadge.style.display='block';
        enhProgress.style.width='20%';

        // Params
        const model = enhModel.value;
        const shp = parseInt(sharpnessSlider.value);
        const den = parseInt(denoiseSlider.value);
        const col = parseInt(colorBoostSlider.value);
        const rst = enhRestoration.value;
        const up  = parseInt(enhUpscale.value);

        // 1. Denoise
        let res = new ImageData(new Uint8ClampedArray(sourceImgData.data), sourceImgData.width, sourceImgData.height);
        if(den>0) res = DenoiseProcessor.bilateral(res, den);
        enhProgress.style.width='40%';
        await new Promise(r=>setTimeout(r,10)); // UI yield

        // 2. Model Sim
        res = await runModelPipeline(res, model, rst);
        enhProgress.style.width='60%';
        await new Promise(r=>setTimeout(r,10));

        // 3. User Tuners
        if(shp!==100) res = SharpnessProcessor.unsharpMask(res, shp);
        if(col!==60)  res = ColorEnhancer.boost(res, col);
        enhProgress.style.width='80%';
        
        // 4. Upscale
        if(up>1) res = await upscaleImage(res, up);

        // Render
        outputCanvas.width=res.width; outputCanvas.height=res.height;
        outputCtx.putImageData(res, 0, 0);
        enhancedImgData=res;
        
        enhPlaceholder.style.display='none';
        
        const dt=performance.now()-t0;
        enhTimeEl.textContent=dt.toFixed(0);
        enhQualityEl.textContent=calcQuality(res);
        
        enhProgress.style.width='100%';
        setTimeout(()=>enhProgress.style.width='0%', 300);
        
        enhPerfBadge.textContent=`✅ ${dt.toFixed(0)}ms`;
        
        updateCompare();
    }

    // ─── UI & Compare ──────────────────────────────────────

    function updateCompare() {
        if(compareCard.style.display==='none' || !sourceImgData || !enhancedImgData) return;
        compareSrc.width=sourceImgData.width; compareSrc.height=sourceImgData.height;
        compareTgt.width=enhancedImgData.width; compareTgt.height=enhancedImgData.height;
        
        compareSrc.getContext('2d').putImageData(sourceImgData,0,0);
        // We scale target to source size for comparison if upscaled
        const tc=compareTgt.getContext('2d');
        tc.putImageData(enhancedImgData,0,0);
    }

    // Compare slider drag
    let isDragging=false;
    compareCard.addEventListener('mousedown', e=>{ if(e.target===compareHandle) isDragging=true; });
    window.addEventListener('mouseup', ()=>isDragging=false);
    window.addEventListener('mousemove', e=>{
        if(!isDragging) return;
        const rect = $('#enhCompareContainer').getBoundingClientRect();
        let p = (e.clientX - rect.left)/rect.width;
        p = Math.max(0, Math.min(1, p));
        compareOverlay.style.width = (p*100)+'%';
        compareHandle.style.left = (p*100)+'%';
    });

    $('#enhCloseCompareBtn').addEventListener('click', ()=>{
        compareCard.style.display='none';
    });

    // ─── Load Source ───────────────────────────────────────

    function setSource(img) {
        sourceCanvas.width=img.width; sourceCanvas.height=img.height;
        sourceCtx.drawImage(img,0,0);
        sourceImgData=sourceCtx.getImageData(0,0,img.width,img.height);
        enhSourceEmpty.style.display='none';
        enhSourceInfo.textContent=`${img.width} × ${img.height}`;
        processEnhancement();
    }

    $('#enhUploadBtn').addEventListener('click', ()=>{
        const i=document.createElement('input'); i.type='file'; i.accept='image/*';
        i.onchange=e=>{
            const f=e.target.files[0]; if(!f)return;
            const r=new FileReader();
            r.onload=ev=>{
                const img=new Image();
                img.onload=()=>setSource(img);
                img.src=ev.target.result;
            };
            r.readAsDataURL(f);
        };
        i.click();
    });

    $('#enhCamBtn').addEventListener('click', async()=>{
        try{
            const s=await navigator.mediaDevices.getUserMedia({video:true});
            const v=document.createElement('video'); v.srcObject=s; v.autoplay=true;
            v.onloadedmetadata=()=>{
                const c=document.createElement('canvas');
                c.width=v.videoWidth; c.height=v.videoHeight;
                c.getContext('2d').drawImage(v,0,0);
                s.getTracks().forEach(t=>t.stop());
                const img=new Image();
                img.onload=()=>setSource(img);
                img.src=c.toDataURL();
            };
        }catch(e){console.error(e);}
    });

    // ─── Buttons & Events ──────────────────────────────────

    $('#enhApplyBtn').addEventListener('click', processEnhancement);
    
    $('#enhAutoBtn').addEventListener('click', ()=>{
        if(autoEnhanceInterval){
            clearInterval(autoEnhanceInterval); autoEnhanceInterval=null;
            $('#enhAutoBtn').textContent='🔄 Auto';
        } else {
            autoEnhanceInterval=setInterval(processEnhancement, 2000);
            $('#enhAutoBtn').textContent='⏹ Stop';
        }
    });

    $('#enhDownloadBtn').addEventListener('click', ()=>{
        if(!enhancedImgData)return;
        const a=document.createElement('a');
        a.download=`clonemax_enhanced_${Date.now()}.png`;
        a.href=outputCanvas.toDataURL(); a.click();
    });

    // Re-render when compare opens
    $('#enhOutputCanvas').addEventListener('click', ()=>{
        if(!enhancedImgData)return;
        compareCard.style.display='block';
        updateCompare();
        compareOverlay.style.width='50%';
        compareHandle.style.left='50%';
        compareCard.scrollIntoView({behavior:'smooth'});
    });

    // Update slider text
    sharpnessSlider.addEventListener('input', ()=>sharpnessVal.textContent=sharpnessSlider.value+'%');
    denoiseSlider.addEventListener('input', ()=>denoiseVal.textContent=denoiseSlider.value+'%');
    colorBoostSlider.addEventListener('input', ()=>colorBoostVal.textContent=colorBoostSlider.value+'%');

    // Init
    const initSrc=localStorage.getItem('clonemax_reference');
    if(initSrc){
        const img=new Image();
        img.onload=()=>setSource(img);
        img.src=initSrc;
    }
})();
