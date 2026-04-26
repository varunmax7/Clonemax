<div align="center">

# 🎭 Clonemax — Real-Time Face Cloning Engine

**A browser-based, real-time face swapping and cloning application built entirely with vanilla JavaScript, WebRTC, and MediaPipe AI.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black)](#tech-stack)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Face_Mesh-4285F4?logo=google&logoColor=white)](#tech-stack)
[![WebRTC](https://img.shields.io/badge/WebRTC-Camera_API-333333?logo=webrtc&logoColor=white)](#tech-stack)

<br/>

<img src="https://img.shields.io/badge/Status-Production_Ready-34d399?style=for-the-badge" />
<img src="https://img.shields.io/badge/Modules-9_Integrated-818cf8?style=for-the-badge" />
<img src="https://img.shields.io/badge/Landmarks-468_Points-fbbf24?style=for-the-badge" />

</div>

---

## 📋 Table of Contents

- [Problem Statement](#-problem-statement)
- [What We Built](#-what-we-built)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Module Documentation](#-module-documentation)
- [Processing Pipeline](#-processing-pipeline)
- [How to Run](#️-how-to-run)
- [Project Structure](#-project-structure)
- [Key Algorithms](#-key-algorithms)
- [Browser Compatibility](#-browser-compatibility)
- [Known Limitations](#️-known-limitations)
- [Future Roadmap](#-future-roadmap)
- [License](#-license)

---

## 🎯 Problem Statement

Face-swapping technology has traditionally been locked behind expensive, GPU-intensive desktop applications (DeepFaceLab, FaceSwap) that require:

- **Python + CUDA environments** with complex setup procedures
- **High-end NVIDIA GPUs** for real-time inference
- **Large model downloads** (2-5 GB per model)
- **Technical expertise** to configure training pipelines

This creates a massive accessibility barrier. Content creators, educators, VFX artists, and developers who want to experiment with face-swapping have no lightweight option that works out-of-the-box.

### Our Solution

**Clonemax** eliminates all of these barriers by delivering a **zero-installation, browser-native face cloning engine** that runs entirely on the client side. No Python. No GPU drivers. No model downloads. Just open a browser and start cloning.

We achieve this through:

| Challenge | Our Approach |
|:---|:---|
| GPU dependency | Pure JavaScript pixel manipulation on HTML5 Canvas |
| Complex setup | Single `index.html` — open and go |
| Model downloads | CDN-hosted MediaPipe Face Mesh (loads on demand) |
| Real-time performance | Cached Delaunay triangulation + bilinear warping |
| Color mismatch | Laplacian high-pass color transfer (per-frame) |
| Hard edges | Erode → Gaussian blur feather blending pipeline |

---

## 🚀 What We Built

Clonemax is a **9-module single-page application** that implements a complete face-cloning pipeline:

```
Reference Image → Face Detection → 468 Landmarks → Delaunay Triangulation
                                                              ↓
Live Camera → Frame Capture → Face Detection → 468 Landmarks → Affine Warp → Color Match → Feather Blend → Output
                                                              ↑
                                                    Mask Options → Enhancement → Audio Sync
```

### Key Capabilities

- ✅ **468-point face mesh** tracking (not just 68 — 7× more accurate)
- ✅ **Bilinear interpolation** for sub-pixel smooth texture warping
- ✅ **Laplacian high-pass color transfer** — adapts to any lighting condition
- ✅ **Face oval convex hull masking** — no forehead/hairline artifacts
- ✅ **Erode + separable Gaussian feather blending** — invisible seams
- ✅ **Cached triangulation** — compute once, reuse every frame
- ✅ **Multi-face tracking** — up to 10 simultaneous faces
- ✅ **White balance correction** — fixes blue-tinted webcams
- ✅ **Audio preservation** — mic input synced with video output
- ✅ **Real-time FPS monitoring** with frame drop strategy

---

## 🛠 Tech Stack

### Core Technologies

| Layer | Technology | Purpose |
|:---|:---|:---|
| **Structure** | HTML5 | Semantic SPA layout with 9 tabbed modules |
| **Styling** | CSS3 (Vanilla) | Ambient dark-mode design system with CSS variables |
| **Logic** | JavaScript ES2022 | IIFE-encapsulated modular architecture |
| **Typography** | Google Fonts (Inter, JetBrains Mono) | Premium UI typography |

### AI & Computer Vision

| Library | Version | Purpose |
|:---|:---|:---|
| **MediaPipe Face Mesh** | `@mediapipe/face_mesh` | 468-point facial landmark detection |
| **MediaPipe Camera Utils** | `@mediapipe/camera_utils` | WebRTC camera frame pipeline |
| **face-api.js** | `@vladmandic/face-api` | SSD MobileNet face detection + 68-point landmarks |

### Web APIs

| API | Purpose |
|:---|:---|
| `navigator.mediaDevices.getUserMedia()` | WebRTC camera access |
| `Canvas 2D API` | Pixel-level image manipulation |
| `Web Audio API` | Microphone capture, FFT analysis, noise suppression |
| `MediaRecorder API` | Audio/video blob recording |
| `requestAnimationFrame` | Throttled render loop |
| `localStorage` | Reference image persistence across modules |

### Algorithms (Custom Implementation)

| Algorithm | Used In |
|:---|:---|
| Bowyer-Watson Delaunay Triangulation | Triangle mesh generation |
| Affine Transformation (2×3 matrix) | Per-triangle warping |
| Bilinear Interpolation | Sub-pixel texture sampling |
| Laplacian High-Pass Decomposition | Color/lighting transfer |
| Separable Box Blur (2-pass) | Feather mask generation |
| Morphological Erosion | Edge artifact removal |
| Convex Hull Scan-line Fill | Face oval masking |
| Gray World White Balance | Blue camera correction |
| Euclidean Distance Tracking | Multi-face ID persistence |

---

## 🏗 Architecture

### Design Pattern: IIFE Module Encapsulation

Each module is wrapped in an **Immediately Invoked Function Expression (IIFE)** to prevent global namespace pollution:

```javascript
// Each .js file follows this pattern:
(() => {
    'use strict';
    const $ = s => document.querySelector(s);
    
    // Module-private state
    let internalState = null;
    
    // Module logic...
    
    // Expose only what's needed
    window.CloneMax = window.CloneMax || {};
    window.CloneMax.moduleMethod = () => { /* ... */ };
})();
```

### Inter-Module Communication

Modules communicate through:

1. **`localStorage`** — Reference images saved by Module 1, loaded by Module 4
2. **`CustomEvent` dispatch** — `window.dispatchEvent(new CustomEvent('reference-updated'))`
3. **Shared `window.CloneMax` namespace** — For cross-module status queries

### CSS Design System

All styling uses a centralized variable system for the "Ambient Dark" theme:

```css
:root {
    --bg-primary: #0a0a15;
    --accent-primary: #667eea;
    --accent-secondary: #764ba2;
    --accent-gradient: linear-gradient(135deg, #667eea, #764ba2);
    --success: #34d399;
    --error: #f87171;
    --radius-md: 12px;
    --border-subtle: rgba(255,255,255,0.08);
}
```

---

## 📖 Module Documentation

### Module 1 — Face Reference Input

**File:** `app.js` (585 lines)

| Feature | Implementation |
|:---|:---|
| Image Upload | Drag & drop + click-to-upload with file validation |
| Format Support | JPG, PNG, WEBP, BMP (max 10 MB) |
| Face Detection | `face-api.js` SSD MobileNet v1 |
| Landmark Extraction | 68-point facial landmark model |
| Quality Validation | 6-point scoring: size, centering, tilt, confidence, proportions, resolution |
| Demographics | Age estimation + gender classification |
| Landmark Visualization | Color-coded overlay: eyes (indigo), nose (amber), mouth (red), jawline (green) |
| Reference Export | Saves to `localStorage` for cross-module use |

**Quality Check Pipeline:**

1. **Face Size** — Minimum 100×100 px (warning below 200×200)
2. **Centering** — Face center offset from image center (< 30%)
3. **Head Tilt** — Eye-line angle calculation (< 15° acceptable)
4. **Detection Confidence** — SSD score threshold (≥ 0.85 = high)
5. **Aspect Ratio** — Height/width between 0.5–1.5
6. **Image Resolution** — Minimum 200×200 px

---

### Module 2 — Live Camera

**File:** `camera.js` (450+ lines)

| Feature | Implementation |
|:---|:---|
| Camera Access | `getUserMedia()` with fallback handling |
| Device Selection | Enumerates all video input devices |
| Resolution Options | 480p, 720p, 1080p, 4K presets |
| Facing Mode | Front/rear camera toggle (mobile support) |
| Frame Capture | Canvas snapshot to PNG/JPEG |
| Frame Extraction | Continuous frame buffer for batch processing |
| Mirror Mode | Horizontal flip for selfie-style preview |
| Stream Controls | Play, pause, stop with proper track cleanup |

---

### Module 3 — Face Detection

**File:** `detection.js` (600+ lines)

| Feature | Implementation |
|:---|:---|
| Dual Engine | MediaPipe Face Mesh (468 pts) + face-api.js (68 pts) |
| Engine Switching | Toggle between engines at runtime |
| Live Detection | Real-time bounding box + landmark overlay |
| Performance Metrics | Detection time, FPS, face count |
| Landmark Groups | Eyes, eyebrows, nose, mouth, jawline (color-coded) |
| Confidence Scoring | Per-face detection confidence display |

**MediaPipe Configuration:**

```javascript
faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});
```

---

### Module 4 — Face Swapping / Cloning Engine

**File:** `swapping.js` (500+ lines) — **The core engine**

This is the heart of Clonemax. It implements the complete face-swap pipeline:

#### 4.1 Delaunay Triangulation (Bowyer-Watson)

The engine divides the face into ~900 micro-triangles using the Bowyer-Watson incremental algorithm:

```
Input:  468 landmark points
Output: ~918 non-overlapping triangles covering the face
```

The triangulation is **computed once** when the reference face is detected, and the triangle index array is cached for all subsequent frames.

#### 4.2 Affine Warping with Bilinear Interpolation

For each triangle, a 2×3 affine transformation matrix maps source → destination coordinates:

```
| a  b  c |       | x |       | x' |
| d  e  f |   ×   | y |   =   | y' |
                   | 1 |
```

Each pixel inside a destination triangle is reverse-mapped to the source image using **bilinear interpolation** (sampling 4 neighboring pixels) instead of nearest-neighbor, eliminating pixelation artifacts.

#### 4.3 Face Oval Convex Hull Masking

After warping, the engine clips the result to MediaPipe's **FACE_OVAL** contour (36 landmark indices defining the outer face boundary). This prevents hair, ears, and background from bleeding into the output.

```javascript
const FACE_OVAL = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];
```

#### 4.4 Laplacian High-Pass Color Transfer

The most critical step for natural results. Instead of simple brightness matching, the engine:

1. Computes a **mask-aware separable blur** of both the warped face and the live frame
2. Extracts the **low-frequency lighting envelope** from the live camera
3. Extracts the **high-frequency facial detail** from the reference face
4. Combines them: `output = refDetail + liveColor`

This ensures the swapped face adopts the exact ambient lighting, shadows, and skin tone of the live environment.

#### 4.5 Feather Blending Pipeline

```
Raw Mask → Morphological Erosion (r=3) → Separable Gaussian Blur (r=30) → Alpha Composite
```

1. **Erosion** shrinks the mask by 3px to remove edge artifacts
2. **Horizontal blur pass** smooths the mask left-right
3. **Vertical blur pass** smooths the mask top-bottom
4. **Alpha composite** blends warped face into live frame using the smooth mask

---

### Module 5 — Face Enhancer

**File:** `enhancer.js` (500+ lines)

| Feature | Implementation |
|:---|:---|
| GPEN Simulation | Bilateral filter + contrast enhancement (256/512 modes) |
| GFPGAN Simulation | Multi-pass sharpening with edge preservation |
| CodeFormer Simulation | Adaptive detail recovery with fidelity control |
| Sharpness Control | Unsharp masking with adjustable kernel |
| Bilateral Filter | Edge-preserving smoothing (skin refinement) |
| Laplacian Enhancement | High-frequency detail boost |

> **Note:** True GPEN/GFPGAN require PyTorch GPU inference. The client-side module simulates their visual effect using mathematical image filters. For production-grade enhancement, a backend API is recommended.

---

### Module 6 — Mask Options

**File:** `mask.js` (293 lines)

| Feature | Implementation |
|:---|:---|
| Mouth Mask | Binary mask from mouth contour landmarks |
| Eye Mask | Bilateral eye region masking |
| Face Outline | Full jawline contour overlay |
| Nose Mask | Nose bridge + tip region |
| Mask Styles | Solid, outline, gradient, crosshatch pattern |
| Transparency | Real-time alpha slider (0–100%) |
| Color Picker | Custom RGB color for each mask region |
| Show Bounding Box | Toggle mask region bounding box overlay |

---

### Module 7 — Performance Controls

**File:** `performance.js` (350+ lines)

| Feature | Implementation |
|:---|:---|
| FPS Limiter | `requestAnimationFrame` throttle (1–60 FPS) |
| Frame Buffer | Configurable buffer size with drop strategy |
| Drop Strategy | Oldest-first, newest-first, or random frame dropping |
| Live FPS Display | Rolling average with color-coded indicator |
| Frame Timing | Per-frame processing time histogram |
| Memory Monitor | Estimated buffer memory usage |
| Render Stats | Triangle count, warp time, blend time |

---

### Module 8 — Audio Handling

**File:** `audio.js` (300+ lines)

| Feature | Implementation |
|:---|:---|
| Mic Capture | `getUserMedia({ audio: true })` |
| Audio Visualization | Real-time FFT waveform + frequency bars |
| Noise Suppression | Web Audio `BiquadFilterNode` (low-pass + high-pass) |
| Gain Control | `GainNode` with real-time volume slider |
| Audio Recording | `MediaRecorder` with blob buffering |
| A/V Sync | Timestamp-aligned audio + video streams |
| Mute Toggle | Instant mic mute without stopping the stream |

---

### Module 9 — Multi-Face & Fixes

**File:** `multi_face.js` (400+ lines)

| Feature | Implementation |
|:---|:---|
| Multi-Face Detection | MediaPipe `maxNumFaces: 10` |
| Face Tracking Array | Euclidean distance-based ID persistence |
| Individual Processing | Per-face bounding box, landmarks, confidence |
| Movement Trails | 10-frame position history visualization |
| White Balance Fix | Manual temperature (2000K–10000K) adjustment |
| Blue Light Reduction | Targeted blue channel attenuation |
| Auto Gray World | Statistical RGB gain balancing |
| Face Selection | Click-to-select individual tracked faces |

**Tracking Algorithm:**

```
For each detected face:
  1. Compute center point (cx, cy)
  2. Find nearest existing tracked face (Euclidean distance < 150px)
  3. If match → update position, increment frame count
  4. If no match → assign new ID
  5. If tracked face missed > 10 frames → remove from array
```

---

## 🔄 Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLONEMAX PIPELINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐  │
│  │  Reference   │──▶│  MediaPipe     │──▶│  468 Landmarks   │  │
│  │  Image       │   │  Face Mesh     │   │  (cached)        │  │
│  └──────────────┘   └────────────────┘   └────────┬─────────┘  │
│                                                   │            │
│                                        ┌──────────▼─────────┐  │
│                                        │ Delaunay Triangul.  │  │
│                                        │ (~918 triangles)    │  │
│                                        │ (cached indices)    │  │
│                                        └──────────┬─────────┘  │
│                                                   │            │
│  ┌──────────────┐   ┌────────────────┐   ┌────────▼─────────┐  │
│  │  Live        │──▶│  MediaPipe     │──▶│  Affine Warp     │  │
│  │  Camera      │   │  Face Mesh     │   │  (bilinear)      │  │
│  │  Frame       │   │  (per-frame)   │   └────────┬─────────┘  │
│  └──────────────┘   └────────────────┘            │            │
│                                        ┌──────────▼─────────┐  │
│                                        │  Face Oval Mask    │  │
│                                        │  (convex hull)     │  │
│                                        └──────────┬─────────┘  │
│                                                   │            │
│                                        ┌──────────▼─────────┐  │
│                                        │  Laplacian Color   │  │
│                                        │  Transfer          │  │
│                                        └──────────┬─────────┘  │
│                                                   │            │
│                                        ┌──────────▼─────────┐  │
│                                        │  Feather Blend     │  │
│                                        │  erode → blur →    │  │
│                                        │  alpha composite   │  │
│                                        └──────────┬─────────┘  │
│                                                   │            │
│                                        ┌──────────▼─────────┐  │
│                                        │  Final Output      │  │
│                                        │  (Canvas)          │  │
│                                        └────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ▶️ How to Run

### Prerequisites

- A modern web browser (Chrome 90+, Firefox 88+, Edge 90+, Safari 15+)
- A webcam (built-in or external)
- Internet connection (for CDN-hosted AI models on first load)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/varunmax7/Clonemax.git
cd Clonemax

# 2. Start any local HTTP server:

# Option A: Python
python3 -m http.server 8080

# Option B: Node.js
npx serve .

# Option C: PHP
php -S localhost:8080

# Option D: VS Code Live Server extension
# Right-click index.html → "Open with Live Server"

# 3. Open in browser
open http://localhost:8080
```

### Step-by-Step Usage

1. **Open the app** → Wait for "Models Ready" status (5-10 seconds)
2. **Tab 1 (Reference)** → Upload a clear, frontal face photo → Verify "Validation Passed"
3. **Tab 4 (Swapping)** → Click "Upload" or use saved reference → Click "Detect Face" → Confirm "468 landmarks"
4. **Click "Start Cloning"** → Your face is now cloned in real-time
5. **Click "Capture"** → Download a snapshot as PNG

### Important Settings for Best Results

| Setting | Recommended Value |
|:---|:---|
| Reference Photo | Well-lit, frontal face, 500×500 px minimum |
| Opacity | 90–100% |
| Blend Mode | Feather (auto-selected) |
| Color Transfer | Luminance Match (auto-enabled) |
| Lighting | Match reference photo lighting if possible |

---

## 📁 Project Structure

```
Clonemax/
├── index.html          # Single-page app shell (1157 lines)
│                       # All 9 module panels, tab navigation, CDN imports
│
├── styles.css          # Complete design system (1900+ lines)
│                       # CSS variables, animations, glassmorphism, responsive
│
├── app.js              # Module 1: Reference input, validation, quality checks
├── camera.js           # Module 2: WebRTC camera, device selection, capture
├── detection.js        # Module 3: Dual-engine face detection
├── swapping.js         # Module 4: Core cloning engine (triangulation + warp + blend)
├── enhancer.js         # Module 5: Image enhancement filters
├── mask.js             # Module 6: Facial region masking
├── performance.js      # Module 7: FPS control, frame management
├── audio.js            # Module 8: Web Audio API, recording
├── multi_face.js       # Module 9: Multi-face tracking, white balance
│
└── README.md           # This documentation
```

**Total codebase:** 12 files · ~267 KB · ~5,500 lines of code

---

## 🧮 Key Algorithms

### Bowyer-Watson Delaunay Triangulation

Incrementally inserts each landmark point into an existing triangulation:

1. Start with a super-triangle encompassing all points
2. For each new point, find all triangles whose circumcircle contains it
3. Remove those triangles, creating a polygonal hole
4. Re-triangulate the hole by connecting the new point to each edge
5. Filter out triangles sharing vertices with the super-triangle

**Time complexity:** O(n log n) average, O(n²) worst case

### Bilinear Interpolation

For a source coordinate (sx, sy) that falls between integer pixel positions:

```
f(x,y) = f(0,0)·(1-fx)·(1-fy) + f(1,0)·(fx)·(1-fy)
       + f(0,1)·(1-fx)·(fy)   + f(1,1)·(fx)·(fy)
```

Where `fx = sx - floor(sx)` and `fy = sy - floor(sy)`.

### Laplacian High-Pass Color Transfer

```
srcBlur = maskAwareBlur(warpedFace, radius=20)
dstBlur = maskAwareBlur(liveFrame, radius=20)

output[pixel] = warpedFace[pixel] + (dstBlur[pixel] - srcBlur[pixel])
```

This preserves reference face detail (texture, features) while adopting live lighting (color temperature, shadows, brightness).

---

## 🌐 Browser Compatibility

| Browser | Version | Status |
|:---|:---|:---|
| Google Chrome | 90+ | ✅ Full support |
| Microsoft Edge | 90+ | ✅ Full support |
| Mozilla Firefox | 88+ | ✅ Full support |
| Safari | 15+ | ⚠️ WebRTC permissions may require HTTPS |
| Chrome Android | 90+ | ⚠️ Performance depends on device |
| Safari iOS | 15+ | ⚠️ Limited getUserMedia support |

> **Note:** HTTPS is required for camera access on most mobile browsers.

---

## ⚠️ Known Limitations

1. **Client-side only** — No GPU-accelerated neural inference. Enhancement filters simulate GPEN/GFPGAN effects mathematically.
2. **Performance** — 468-point triangulation with bilinear warping + color transfer runs at ~7-15 FPS on mid-range hardware. High-end machines achieve 20+ FPS.
3. **Extreme angles** — Face tracking degrades when head rotation exceeds ±45°.
4. **Occlusion** — Hands, glasses, or hair covering the face can cause tracking loss.
5. **Lighting extremes** — Very dark or backlit environments reduce detection confidence.

---

## 🔮 Future Roadmap

- [ ] **WebGL Shader Pipeline** — Move warp + blend to GPU for 60 FPS
- [ ] **ONNX Runtime Web** — Run real GFPGAN/CodeFormer models in-browser
- [ ] **WebSocket Backend** — Optional Python/FastAPI server for PyTorch inference
- [ ] **Temporal Smoothing** — Kalman filter on landmarks to reduce jitter
- [ ] **Expression Transfer** — Map reference expression to live face (not just texture)
- [ ] **Video File Input** — Swap faces in uploaded video files (not just live camera)
- [ ] **Preset System** — Save/load swap configurations via localStorage
- [ ] **PWA Support** — Installable as a Progressive Web App

---

## 📄 License

This project is licensed under the **MIT License**.

```
MIT License

Copyright (c) 2026 Clonemax

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
```

---

<div align="center">

**Built with ❤️ using pure JavaScript, MediaPipe AI, and Canvas 2D**

*No Python. No GPU. No installation. Just open and clone.*

</div>
