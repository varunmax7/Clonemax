/* =========================================================
   Clonemax — Face Swapping / Cloning Engine
   Delaunay triangulation, affine warp & seamless blending
   ========================================================= */
(() => {
    'use strict';
    const $ = s => document.querySelector(s);

    // DOM
    const outCanvas      = $('#swapOutputCanvas');
    const outCtx         = outCanvas.getContext('2d');
    const refCanvas      = $('#swapRefCanvas');
    const refCtx         = refCanvas.getContext('2d');
    const swapPlaceholder= $('#swapPlaceholder');
    const swapLiveBadge  = $('#swapLiveBadge');
    const swapPerfBadge  = $('#swapPerfBadge');
    const swapRefEmpty   = $('#swapRefEmpty');
    const swapRefInfo    = $('#swapRefInfo');
    const swapFpsEl      = $('#swapFps');
    const swapTriEl      = $('#swapTriangles');
    const swapTimeEl     = $('#swapTime');
    const swapBlendEl    = $('#swapBlend');
    const swapStatusMsg  = $('#swapStatusMsg');
    const opacitySlider  = $('#swapOpacity');
    const opacityVal     = $('#swapOpacityVal');
    const sharpSlider    = $('#swapSharpness');
    const sharpVal       = $('#swapSharpnessVal');

    // State
    let stream = null, video = null, faceMesh = null, mpCam = null;
    let isSwapping = false, refImage = null, refLandmarks = null;
    let blendMode = 'feather', frameCount = 0, lastFpsTs = 0, swapTimes = [];
    let refFaceMesh = null, refTriangles = [];
    let cachedRefCanvas = null, cachedRefCtx = null;

    // MediaPipe Face Oval indices (the outer contour of the face)
    const FACE_OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];

    // ─── Delaunay Triangulation (Bowyer-Watson) ────────────
    function triangulate(pts) {
        if (pts.length < 3) return [];
        let mnX=1e9,mnY=1e9,mxX=-1e9,mxY=-1e9;
        pts.forEach(p=>{mnX=Math.min(mnX,p.x);mnY=Math.min(mnY,p.y);mxX=Math.max(mxX,p.x);mxY=Math.max(mxY,p.y)});
        const d=Math.max(mxX-mnX,mxY-mnY)*10;
        const s1={x:mnX-d,y:mnY-d},s2={x:mxX+d,y:mnY-d},s3={x:(mnX+mxX)/2,y:mxY+d};
        let tris=[{a:s1,b:s2,c:s3}];
        for(const p of pts){
            const bad=[],edges=[];
            for(const t of tris) if(inCircum(p,t.a,t.b,t.c)) bad.push(t);
            for(const t of bad) edges.push([t.a,t.b],[t.b,t.c],[t.c,t.a]);
            const unique=[];
            for(let i=0;i<edges.length;i++){
                let dup=false;
                for(let j=0;j<edges.length;j++){
                    if(i===j)continue;
                    if((edges[i][0]===edges[j][1]&&edges[i][1]===edges[j][0])||(edges[i][0]===edges[j][0]&&edges[i][1]===edges[j][1])){dup=true;break;}
                }
                if(!dup)unique.push(edges[i]);
            }
            tris=tris.filter(t=>!bad.includes(t));
            for(const e of unique) tris.push({a:e[0],b:e[1],c:p});
        }
        return tris.filter(t=>t.a!==s1&&t.a!==s2&&t.a!==s3&&t.b!==s1&&t.b!==s2&&t.b!==s3&&t.c!==s1&&t.c!==s2&&t.c!==s3);
    }
    function inCircum(p,a,b,c){
        const ax=a.x-p.x,ay=a.y-p.y,bx=b.x-p.x,by=b.y-p.y,cx=c.x-p.x,cy=c.y-p.y;
        return(ax*ax+ay*ay)*(bx*cy-by*cx)-(bx*bx+by*by)*(ax*cy-ay*cx)+(cx*cx+cy*cy)*(ax*by-ay*bx)>0;
    }

    // ─── Affine Transform ──────────────────────────────────
    function getAffine(src,dst){
        // solve 2x3 affine: dst = M * src
        const x0=src[0].x,y0=src[0].y,x1=src[1].x,y1=src[1].y,x2=src[2].x,y2=src[2].y;
        const u0=dst[0].x,v0=dst[0].y,u1=dst[1].x,v1=dst[1].y,u2=dst[2].x,v2=dst[2].y;
        const det=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);
        if(Math.abs(det)<1e-10) return null;
        const id=1/det;
        return{
            a:((u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))*id),
            b:((u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))*id),
            c:u0-((u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))*id)*x0-((u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))*id)*y0,
            d:((v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))*id),
            e:((v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))*id),
            f:v0-((v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))*id)*x0-((v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))*id)*y0,
        };
    }

    function warpTriangle(srcData,srcW,srcH,dstData,dstW,dstH,srcTri,dstTri){
        const M=getAffine(dstTri,srcTri);
        if(!M)return;
        const mnX=Math.max(0,Math.floor(Math.min(dstTri[0].x,dstTri[1].x,dstTri[2].x)));
        const mnY=Math.max(0,Math.floor(Math.min(dstTri[0].y,dstTri[1].y,dstTri[2].y)));
        const mxX=Math.min(dstW-1,Math.ceil(Math.max(dstTri[0].x,dstTri[1].x,dstTri[2].x)));
        const mxY=Math.min(dstH-1,Math.ceil(Math.max(dstTri[0].y,dstTri[1].y,dstTri[2].y)));
        for(let y=mnY;y<=mxY;y++){
            for(let x=mnX;x<=mxX;x++){
                if(!ptInTri(x,y,dstTri))continue;
                const sx=M.a*x+M.b*y+M.c, sy=M.d*x+M.e*y+M.f;
                if(sx<0||sx>=srcW-1||sy<0||sy>=srcH-1)continue;
                // Bilinear interpolation
                const x0=Math.floor(sx), y0=Math.floor(sy);
                const fx=sx-x0, fy=sy-y0;
                const i00=(y0*srcW+x0)*4, i10=(y0*srcW+x0+1)*4;
                const i01=((y0+1)*srcW+x0)*4, i11=((y0+1)*srcW+x0+1)*4;
                const di=(y*dstW+x)*4;
                for(let c=0;c<3;c++){
                    dstData[di+c]=
                        srcData[i00+c]*(1-fx)*(1-fy)+
                        srcData[i10+c]*fx*(1-fy)+
                        srcData[i01+c]*(1-fx)*fy+
                        srcData[i11+c]*fx*fy;
                }
                dstData[di+3]=255;
            }
        }
    }

    function ptInTri(px,py,t){
        const d1=sign(px,py,t[0],t[1]),d2=sign(px,py,t[1],t[2]),d3=sign(px,py,t[2],t[0]);
        const neg=(d1<0)||(d2<0)||(d3<0), pos=(d1>0)||(d2>0)||(d3>0);
        return!(neg&&pos);
    }
    function sign(px,py,a,b){return(px-b.x)*(a.y-b.y)-(a.x-b.x)*(py-b.y);}

    // ─── Blending ──────────────────────────────────────────
    function alphaBlend(src,dst,len,alpha){
        for(let i=0;i<len;i+=4){
            if(src[i+3]===0)continue;
            dst[i]=src[i]*alpha+dst[i]*(1-alpha);
            dst[i+1]=src[i+1]*alpha+dst[i+1]*(1-alpha);
            dst[i+2]=src[i+2]*alpha+dst[i+2]*(1-alpha);
        }
    }

    function featherBlend(src,dst,w,h,alpha,radius){
        // Extract mask from alpha
        const mask=new Float32Array(w*h);
        for(let i=0;i<w*h;i++) mask[i]=src[i*4+3]>0?1:0;
        
        // 1. Erode the mask inward slightly so we don't blend background pixels
        const eroded=new Float32Array(w*h);
        const erodeR = 3;
        for(let y=0;y<h;y++) {
            for(let x=0;x<w;x++) {
                let keep=1;
                for(let dy=-erodeR;dy<=erodeR;dy++) {
                    for(let dx=-erodeR;dx<=erodeR;dx++) {
                        const ny=y+dy, nx=x+dx;
                        if(ny>=0&&ny<h&&nx>=0&&nx<w) {
                            if(mask[ny*w+nx]===0) { keep=0; break; }
                        } else { keep=0; break; }
                    }
                    if(!keep) break;
                }
                eroded[y*w+x] = keep;
            }
        }

        // 2. Fast Box/Gaussian blur (separable 2-pass)
        const tmp=new Float32Array(w*h);
        const tmp2=new Float32Array(w*h);
        const r=Math.min(radius*2, 30); // increase feather radius
        
        // Horizontal pass
        for(let y=0;y<h;y++){
            for(let x=0;x<w;x++){
                let s=0,c=0;
                for(let dx=-r;dx<=r;dx++){
                    const nx=x+dx;
                    if(nx>=0&&nx<w){s+=eroded[y*w+nx];c++;}
                }
                tmp2[y*w+x]=s/c;
            }
        }
        // Vertical pass
        for(let y=0;y<h;y++){
            for(let x=0;x<w;x++){
                let s=0,c=0;
                for(let dy=-r;dy<=r;dy++){
                    const ny=y+dy;
                    if(ny>=0&&ny<h){s+=tmp2[ny*w+x];c++;}
                }
                tmp[y*w+x]=s/c;
            }
        }

        // Apply feathered alpha
        for(let i=0;i<w*h;i++){
            const a=tmp[i]*alpha;
            if(a<0.01)continue;
            dst[i*4]   = src[i*4]*a   + dst[i*4]*(1-a);
            dst[i*4+1] = src[i*4+1]*a + dst[i*4+1]*(1-a);
            dst[i*4+2] = src[i*4+2]*a + dst[i*4+2]*(1-a);
        }
    }

    function poissonBlend(src,dst,w,h,alpha){
        // Since pure poisson is too slow, we map it to an aggressive feather
        featherBlend(src,dst,w,h,alpha,25);
    }

    // ─── Color Transfer (Laplacian High-Pass Matching) ──────────────────
    function maskAwareBlur(img, mask, w, h, radius) {
        const tmp = new Float32Array(w*h*3);
        const out = new Float32Array(w*h*3);
        // horizontal
        for(let y=0;y<h;y++){
            for(let x=0;x<w;x++){
                if(!mask[y*w+x]) continue;
                let sr=0, sg=0, sb=0, c=0;
                for(let dx=-radius; dx<=radius; dx++){
                    const nx=x+dx;
                    if(nx>=0 && nx<w && mask[y*w+nx]){
                        const i=(y*w+nx)*4;
                        sr+=img[i]; sg+=img[i+1]; sb+=img[i+2]; c++;
                    }
                }
                const o=(y*w+x)*3;
                if(c>0){ tmp[o]=sr/c; tmp[o+1]=sg/c; tmp[o+2]=sb/c; }
            }
        }
        // vertical
        for(let y=0;y<h;y++){
            for(let x=0;x<w;x++){
                if(!mask[y*w+x]) continue;
                let sr=0, sg=0, sb=0, c=0;
                for(let dy=-radius; dy<=radius; dy++){
                    const ny=y+dy;
                    if(ny>=0 && ny<h && mask[ny*w+x]){
                        const i=(ny*w+x)*3;
                        sr+=tmp[i]; sg+=tmp[i+1]; sb+=tmp[i+2]; c++;
                    }
                }
                const o=(y*w+x)*3;
                if(c>0){ out[o]=sr/c; out[o+1]=sg/c; out[o+2]=sb/c; }
            }
        }
        return out;
    }

    function matchLuminance(srcD,dstD,len,w,h){
        // Upgraded to Laplacian High-Pass blend for perfect natural skin tone
        const mask = new Uint8Array(w*h);
        for(let i=0; i<w*h; i++) mask[i] = srcD[i*4+3]>0 ? 1 : 0;
        
        const r = 20; // Blur radius for low frequency lighting/skin tone
        
        const srcBlur = maskAwareBlur(srcD, mask, w, h, r);
        const dstBlur = maskAwareBlur(dstD, mask, w, h, r);
        
        // High-pass transfer: Source Features + Target Lighting/Color
        for(let i=0; i<w*h; i++){
            if(!mask[i]) continue;
            const idx = i*4;
            const o = i*3;
            // dstBlur - srcBlur = color difference
            // src + difference = matched color
            srcD[idx]   = Math.max(0, Math.min(255, srcD[idx]   + (dstBlur[o]   - srcBlur[o])));
            srcD[idx+1] = Math.max(0, Math.min(255, srcD[idx+1] + (dstBlur[o+1] - srcBlur[o+1])));
            srcD[idx+2] = Math.max(0, Math.min(255, srcD[idx+2] + (dstBlur[o+2] - srcBlur[o+2])));
        }
    }

    // ─── Face Swap Pipeline ────────────────────────────────
    function doSwap(dstLandmarks468, w, h){
        const t0=performance.now();
        const dstPts=dstLandmarks468.map(p=>({x:p.x*w, y:p.y*h}));
        const srcPts=refLandmarks;
        if(!srcPts||srcPts.length<468||dstPts.length<468||!refTriangles.length)return;

        const rw=refImage.naturalWidth||refImage.width, rh=refImage.naturalHeight||refImage.height;

        // Cache ref image canvas (don't recreate every frame)
        if(!cachedRefCanvas||cachedRefCanvas.width!==w||cachedRefCanvas.height!==h){
            cachedRefCanvas=document.createElement('canvas');
            cachedRefCanvas.width=w; cachedRefCanvas.height=h;
            cachedRefCtx=cachedRefCanvas.getContext('2d');
            cachedRefCtx.drawImage(refImage,0,0,w,h);
        }
        const srcImg=cachedRefCtx.getImageData(0,0,w,h);
        const scaledSrc=srcPts.map(p=>({x:p.x*w/rw, y:p.y*h/rh}));

        swapTriEl.textContent=refTriangles.length;
        const warpedData=new Uint8ClampedArray(w*h*4);

        // Warp each cached triangle
        for(const tIdx of refTriangles){
            const ia=tIdx[0],ib=tIdx[1],ic=tIdx[2];
            warpTriangle(srcImg.data,w,h,warpedData,w,h,
                [scaledSrc[ia],scaledSrc[ib],scaledSrc[ic]],
                [dstPts[ia],dstPts[ib],dstPts[ic]]);
        }

        // Mask to face oval only (clip warped pixels outside the convex hull)
        const ovalPts=FACE_OVAL.map(i=>dstPts[i]);
        const ovalMask=new Uint8Array(w*h);
        fillConvexPoly(ovalMask,ovalPts,w,h);
        for(let i=0;i<w*h;i++){
            if(!ovalMask[i]){warpedData[i*4+3]=0;}
        }

        // Draw current frame
        outCtx.drawImage(video,0,0,w,h);
        const frameImg=outCtx.getImageData(0,0,w,h);

        // ALWAYS run color transfer for natural skin tone
        matchLuminance(warpedData,frameImg.data,w*h*4,w,h);

        // ALWAYS use feather blend for seamless edges
        const alpha=parseInt(opacitySlider.value)/100;
        featherBlend(warpedData,frameImg.data,w,h,alpha,15);

        outCtx.putImageData(frameImg,0,0);

        const dt=performance.now()-t0;
        swapTimes.push(dt);if(swapTimes.length>30)swapTimes.shift();
        swapTimeEl.textContent=(swapTimes.reduce((a,b)=>a+b)/swapTimes.length).toFixed(1);
        swapBlendEl.textContent='Feather+Color';
    }

    // Fill a convex polygon into a mask buffer
    function fillConvexPoly(mask,pts,w,h){
        if(pts.length<3)return;
        let minY=h,maxY=0;
        for(const p of pts){if(p.y<minY)minY=Math.floor(p.y);if(p.y>maxY)maxY=Math.ceil(p.y);}
        minY=Math.max(0,minY);maxY=Math.min(h-1,maxY);
        for(let y=minY;y<=maxY;y++){
            let xMin=w,xMax=0;
            for(let i=0;i<pts.length;i++){
                const a=pts[i],b=pts[(i+1)%pts.length];
                if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y)){
                    const x=a.x+(y-a.y)/(b.y-a.y)*(b.x-a.x);
                    if(x<xMin)xMin=x;if(x>xMax)xMax=x;
                }
            }
            const x0=Math.max(0,Math.floor(xMin)),x1=Math.min(w-1,Math.ceil(xMax));
            for(let x=x0;x<=x1;x++) mask[y*w+x]=1;
        }
    }

    // ─── MediaPipe ─────────────────────────────────────────
    function initMP(){
        faceMesh=new FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});
        faceMesh.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
        faceMesh.onResults(onResults);
        
        refFaceMesh=new FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});
        refFaceMesh.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:0.5,minTrackingConfidence:0.5});
        refFaceMesh.onResults(onRefResults);
    }

    function onResults(r){
        if(!isSwapping){drawRaw();return;}
        const w=outCanvas.width,h=outCanvas.height;
        if(r.multiFaceLandmarks&&r.multiFaceLandmarks.length>0&&refLandmarks){
            doSwap(r.multiFaceLandmarks[0],w,h);
        } else { drawRaw(); }
        frameCount++;
        const now=performance.now();
        if(now-lastFpsTs>=1000){
            swapFpsEl.textContent=frameCount;
            const fps=frameCount;
            frameCount=0; lastFpsTs=now;
            swapPerfBadge.style.color=fps>20?'#34d399':fps>10?'#fbbf24':'#f87171';
            swapPerfBadge.textContent=`⚡ ${fps} FPS`;
        }
    }

    function drawRaw(){if(video&&video.videoWidth)outCtx.drawImage(video,0,0,outCanvas.width,outCanvas.height);}

    // ─── Camera ────────────────────────────────────────────
    async function startCam(){
        try{
            stream=await navigator.mediaDevices.getUserMedia({video:true});
            video=document.createElement('video');
            video.srcObject=stream;video.autoplay=true;video.muted=true;video.playsInline=true;
            await video.play();
            outCanvas.width=video.videoWidth||640;
            outCanvas.height=video.videoHeight||480;
            swapPlaceholder.style.display='none';
            swapStatusMsg.textContent='Camera ready. Load reference to start.';
        }catch(e){console.error(e);swapStatusMsg.textContent='Camera access failed';}
    }

    // ─── Reference ─────────────────────────────────────────
    function uploadRef(){
        const inp=document.createElement('input');inp.type='file';inp.accept='image/*';
        inp.onchange=e=>{
            const f=e.target.files[0];if(!f)return;
            const r=new FileReader();
            r.onload=ev=>{
                refImage=new Image();
                refImage.onload=()=>{
                    refCanvas.width=refImage.naturalWidth;refCanvas.height=refImage.naturalHeight;
                    refCtx.drawImage(refImage,0,0);
                    swapRefEmpty.style.display='none';
                    $('#swapDetectRefBtn').disabled=false;
                    swapRefInfo.textContent='Reference loaded. Click Detect Face.';
                };
                refImage.src=ev.target.result;
            };
            r.readAsDataURL(f);
        };
        inp.click();
    }

    async function detectRef(){
        if(!refImage)return;
        swapRefInfo.textContent='Detecting 468 points…';
        await refFaceMesh.send({image: refImage});
    }

    function onRefResults(r) {
        if(!r.multiFaceLandmarks||!r.multiFaceLandmarks.length){
            swapRefInfo.innerHTML='<span style="color:var(--error)">❌ No face</span>';
            return;
        }
        const pts = r.multiFaceLandmarks[0];
        const rw=refImage.naturalWidth||refImage.width, rh=refImage.naturalHeight||refImage.height;
        refLandmarks = pts.map(p=>({x:p.x*rw, y:p.y*rh}));
        
        // Cache Triangulation
        const indexedPts = refLandmarks.map((p,i)=>({...p,i}));
        const tris = triangulate(indexedPts);
        refTriangles = tris.map(t => [t.a.i, t.b.i, t.c.i]);

        // draw
        refCtx.drawImage(refImage,0,0);
        refLandmarks.forEach(p=>{refCtx.fillStyle='#34d399';refCtx.beginPath();refCtx.arc(p.x,p.y,2,0,Math.PI*2);refCtx.fill();});
        swapRefInfo.innerHTML=`<span style="color:var(--success)">✅ 468 landmarks (Mapped ${refTriangles.length} tris)</span>`;
        swapStatusMsg.textContent='Reference ready — click Start Cloning!';
    }

    function clearRef(){
        refImage=null;refLandmarks=null;
        refCtx.clearRect(0,0,refCanvas.width,refCanvas.height);
        swapRefEmpty.style.display='';swapRefInfo.textContent='';
        $('#swapDetectRefBtn').disabled=true;
    }

    function loadSavedRef(){
        const d=localStorage.getItem('clonemax_reference');
        if(!d)return;
        refImage=new Image();
        refImage.onload=()=>{
            refCanvas.width=refImage.naturalWidth;refCanvas.height=refImage.naturalHeight;
            refCtx.drawImage(refImage,0,0);swapRefEmpty.style.display='none';
            $('#swapDetectRefBtn').disabled=false;
            swapRefInfo.textContent='Reference from Module 1. Click Detect Face.';
        };
        refImage.src=d;
    }

    // ─── Start / Stop ──────────────────────────────────────
    function startSwap(){
        if(!refLandmarks){swapStatusMsg.textContent='⚠️ Detect reference face first';return;}
        if(!video||!video.videoWidth){swapStatusMsg.textContent='⚠️ Camera not ready';return;}
        isSwapping=true;
        $('#swapStartBtn').disabled=true;$('#swapStopBtn').disabled=false;
        swapLiveBadge.style.display='inline-flex';
        swapPerfBadge.style.display='block';
        swapStatusMsg.textContent='🎭 Cloning active!';
        mpCam=new Camera(video,{
            onFrame:async()=>{if(isSwapping&&faceMesh)await faceMesh.send({image:video});},
            width:outCanvas.width,height:outCanvas.height
        });
        mpCam.start();
    }

    function stopSwap(){
        isSwapping=false;
        if(mpCam){mpCam.stop();mpCam=null;}
        $('#swapStartBtn').disabled=false;$('#swapStopBtn').disabled=true;
        swapLiveBadge.style.display='none';
        swapPerfBadge.style.display='none';
        swapStatusMsg.textContent='Stopped';
        // keep drawing raw
        const raw=()=>{if(!isSwapping&&video&&video.videoWidth){drawRaw();requestAnimationFrame(raw);}};
        raw();
    }

    function capture(){
        const a=document.createElement('a');
        a.download=`clonemax_swap_${Date.now()}.png`;
        a.href=outCanvas.toDataURL();a.click();
        swapStatusMsg.textContent='📸 Captured!';
        setTimeout(()=>{if(swapStatusMsg.textContent==='📸 Captured!')swapStatusMsg.textContent='🎭 Cloning active!';},1500);
    }

    // ─── Events ────────────────────────────────────────────
    $('#swapUploadRefBtn').addEventListener('click',uploadRef);
    $('#swapDetectRefBtn').addEventListener('click',detectRef);
    $('#swapClearRefBtn').addEventListener('click',clearRef);
    $('#swapStartBtn').addEventListener('click',startSwap);
    $('#swapStopBtn').addEventListener('click',stopSwap);
    $('#swapCaptureBtn').addEventListener('click',capture);

    opacitySlider.addEventListener('input',()=>{opacityVal.textContent=opacitySlider.value+'%';});
    sharpSlider.addEventListener('input',()=>{sharpVal.textContent=sharpSlider.value+'%';});

    $('#swapBlendGrid').querySelectorAll('.preset-chip').forEach(b=>{
        b.addEventListener('click',()=>{
            $('#swapBlendGrid').querySelectorAll('.preset-chip').forEach(c=>c.classList.remove('active'));
            b.classList.add('active');
            blendMode=b.dataset.blend;
            swapBlendEl.textContent=b.textContent.split('\n')[0].trim();
        });
    });

    window.addEventListener('reference-updated',loadSavedRef);

    // ─── Init ──────────────────────────────────────────────
    initMP();
    startCam();
    loadSavedRef();
})();
