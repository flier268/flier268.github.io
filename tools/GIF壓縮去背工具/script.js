// ============ 去背點管理 ============
let seedPoints = []; // 存儲去背起始點 [{x, y}]
let isAddingSeedPoints = false;
function updateSeedPointsDisplay() {
    const container = document.getElementById('seedPointsContainer');
    const info = document.getElementById('seedPointsInfo');
    const preview = document.getElementById('originalPreview');
    
    container.innerHTML = '';
    info.textContent = `${seedPoints.length} 個點`;
    
    if (!preview || !preview.naturalWidth) return;
    
    const imgRect = preview.getBoundingClientRect();
    const scaleX = imgRect.width / preview.naturalWidth;
    const scaleY = imgRect.height / preview.naturalHeight;
    
    seedPoints.forEach((point, index) => {
        const marker = document.createElement('div');
        marker.className = 'seed-point';
        marker.style.left = (point.x * scaleX) + 'px';
        marker.style.top = (point.y * scaleY) + 'px';
        
        const number = document.createElement('div');
        number.className = 'seed-point-number';
        number.textContent = index + 1;
        marker.appendChild(number);
        
        container.appendChild(marker);
    });
}
function toggleAddSeedPoints() {
    isAddingSeedPoints = !isAddingSeedPoints;
    const btn = document.getElementById('addSeedPointBtn');
    btn.textContent = isAddingSeedPoints ? '完成設定' : '點擊預覽圖設定';
    btn.classList.toggle('active', isAddingSeedPoints);
}
function clearAllSeedPoints() {
    seedPoints = [];
    updateSeedPointsDisplay();
}
function useDefaultCorners() {
    const preview = document.getElementById('originalPreview');
    if (!preview || !preview.naturalWidth) return;
    
    const w = preview.naturalWidth;
    const h = preview.naturalHeight;
    
    seedPoints = [
        {x: 0, y: 0},
        {x: w - 1, y: 0},
        {x: 0, y: h - 1},
        {x: w - 1, y: h - 1}
    ];
    updateSeedPointsDisplay();
}
// ============ GIF 解析器 ============
class GifDecoder {
    constructor(buffer) {
        this.data = new Uint8Array(buffer);
        this.pos = 0;
    }
    decode() {
        const header = this.readString(6);
        if (!header.startsWith('GIF')) throw new Error('Invalid GIF');
        const width = this.readUint16();
        const height = this.readUint16();
        const packed = this.readByte();
        const bgIndex = this.readByte();
        this.readByte();
        const gctFlag = (packed >> 7) & 1;
        const gctSize = gctFlag ? (1 << ((packed & 7) + 1)) : 0;
        const gct = gctFlag ? this.readColors(gctSize) : null;
        const frames = [];
        let gce = { delay: 100, disposalMethod: 0, transparentIndex: -1 };
        
        // 用於合成的畫布
        let canvas = new Uint8ClampedArray(width * height * 4);
        let prevCanvas = new Uint8ClampedArray(width * height * 4);
        // 初始化為背景色（通常是透明或白色）
        if (gct && gct[bgIndex]) {
            for (let i = 0; i < width * height; i++) {
                canvas[i * 4] = gct[bgIndex][0];
                canvas[i * 4 + 1] = gct[bgIndex][1];
                canvas[i * 4 + 2] = gct[bgIndex][2];
                canvas[i * 4 + 3] = 255;
            }
        }
        while (this.pos < this.data.length) {
            const block = this.readByte();
            if (block === 0x21) {
                const label = this.readByte();
                if (label === 0xF9) {
                    this.readByte();
                    const p = this.readByte();
                    gce = {
                        disposalMethod: (p >> 2) & 7,
                        delay: this.readUint16() * 10 || 100,
                        transparentIndex: (p & 1) ? this.readByte() : (this.readByte(), -1)
                    };
                    this.readByte();
                } else {
                    this.skipSubBlocks();
                }
            } else if (block === 0x2C) {
                // 保存當前畫布狀態（用於 disposal method 3）
                prevCanvas.set(canvas);
                
                const frame = this.readImageFrame(gct, gce, width, height, canvas);
                // 複製合成後的完整畫面
                frames.push({
                    imageData: new Uint8ClampedArray(canvas),
                    delay: gce.delay,
                    disposal: gce.disposalMethod
                });
                
                // 根據 disposal method 處理
                if (gce.disposalMethod === 2) {
                    // 恢復為背景色
                    for (let y = frame.top; y < frame.top + frame.height; y++) {
                        for (let x = frame.left; x < frame.left + frame.width; x++) {
                            const idx = (y * width + x) * 4;
                            if (gct && gct[bgIndex]) {
                                canvas[idx] = gct[bgIndex][0];
                                canvas[idx + 1] = gct[bgIndex][1];
                                canvas[idx + 2] = gct[bgIndex][2];
                                canvas[idx + 3] = 255;
                            } else {
                                canvas[idx + 3] = 0;
                            }
                        }
                    }
                } else if (gce.disposalMethod === 3) {
                    // 恢復為前一幀
                    canvas.set(prevCanvas);
                }
                // disposalMethod 0 或 1：保持當前狀態
                
                gce = { delay: 100, disposalMethod: 0, transparentIndex: -1 };
            } else if (block === 0x3B || block === undefined) {
                break;
            }
        }
        return { width, height, frames };
    }
    readImageFrame(gct, gce, fullW, fullH, canvas) {
        const left = this.readUint16();
        const top = this.readUint16();
        const width = this.readUint16();
        const height = this.readUint16();
        const packed = this.readByte();
        
        const lctFlag = (packed >> 7) & 1;
        const interlaced = (packed >> 6) & 1;
        const lctSize = lctFlag ? (1 << ((packed & 7) + 1)) : 0;
        const colorTable = lctFlag ? this.readColors(lctSize) : gct;
        const minCodeSize = this.readByte();
        const compressed = this.readSubBlocks();
        const indices = this.lzwDecode(compressed, minCodeSize, width * height);
        for (let y = 0; y < height; y++) {
            let srcY = y;
            if (interlaced) {
                const passStarts = [0, 4, 2, 1];
                const passSteps = [8, 8, 4, 2];
                let row = 0;
                outer: for (let pass = 0; pass < 4; pass++) {
                    for (let py = passStarts[pass]; py < height; py += passSteps[pass]) {
                        if (row === y) { srcY = py; break outer; }
                        row++;
                    }
                }
            }
            for (let x = 0; x < width; x++) {
                const idx = indices[srcY * width + x];
                const destIdx = ((top + y) * fullW + (left + x)) * 4;
                // 只有非透明像素才覆蓋
                if (idx !== gce.transparentIndex && colorTable && colorTable[idx]) {
                    canvas[destIdx] = colorTable[idx][0];
                    canvas[destIdx + 1] = colorTable[idx][1];
                    canvas[destIdx + 2] = colorTable[idx][2];
                    canvas[destIdx + 3] = 255;
                }
            }
        }
        return { left, top, width, height };
    }
    readByte() { return this.data[this.pos++]; }
    readUint16() { return this.data[this.pos++] | (this.data[this.pos++] << 8); }
    readString(n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.data[this.pos++]); return s; }
    readColors(n) { const c = []; for (let i = 0; i < n; i++) c.push([this.data[this.pos++], this.data[this.pos++], this.data[this.pos++]]); return c; }
    readSubBlocks() { const d = []; let s; while ((s = this.readByte()) > 0) for (let i = 0; i < s; i++) d.push(this.data[this.pos++]); return d; }
    skipSubBlocks() { let s; while ((s = this.readByte()) > 0) this.pos += s; }
    lzwDecode(data, minCodeSize, pixelCount) {
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        let codeSize = minCodeSize + 1;
        let codeMask = (1 << codeSize) - 1;
        let nextCode = eoiCode + 1;
        
        const table = [];
        for (let i = 0; i < clearCode; i++) table[i] = [i];
        
        const output = [];
        let bits = 0, bitCount = 0, dataIdx = 0, prevCode = -1;
        
        while (output.length < pixelCount && dataIdx < data.length) {
            while (bitCount < codeSize && dataIdx < data.length) {
                bits |= data[dataIdx++] << bitCount;
                bitCount += 8;
            }
            const code = bits & codeMask;
            bits >>= codeSize;
            bitCount -= codeSize;
            
            if (code === clearCode) {
                codeSize = minCodeSize + 1;
                codeMask = (1 << codeSize) - 1;
                nextCode = eoiCode + 1;
                table.length = clearCode + 2;
                prevCode = -1;
                continue;
            }
            if (code === eoiCode) break;
            
            let entry;
            if (code < table.length) entry = table[code];
            else if (code === nextCode && prevCode >= 0) entry = [...table[prevCode], table[prevCode][0]];
            else break;
            
            output.push(...entry);
            if (prevCode >= 0 && nextCode < 4096) {
                table[nextCode++] = [...table[prevCode], entry[0]];
                if (nextCode > codeMask && codeSize < 12) { codeSize++; codeMask = (1 << codeSize) - 1; }
            }
            prevCode = code;
        }
        return output;
    }
}
// ============ GIF 編碼器 ============
class GifEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.frames = [];
    }
    addFrame(imageData, delay = 100, transparentIndex = -1) {
        this.frames.push({ imageData, delay, transparentIndex });
    }
    encode() {
        // 建立全局調色盤
        const allPixels = [];
        for (const frame of this.frames) {
            const data = frame.imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i + 3] > 0) {
                    allPixels.push([data[i], data[i + 1], data[i + 2]]);
                }
            }
        }
        
        const palette = this.buildPalette(allPixels, 255);
        // 添加透明色
        palette.unshift([0, 0, 0]); // index 0 = transparent
        while (palette.length < 256) palette.push([0, 0, 0]);
        
        const bytes = [];
        
        // Header
        this.writeString(bytes, 'GIF89a');
        
        // Logical Screen Descriptor
        this.writeUint16(bytes, this.width);
        this.writeUint16(bytes, this.height);
        bytes.push(0xF7); // Global color table, 256 colors
        bytes.push(0);    // Background color index
        bytes.push(0);    // Pixel aspect ratio
        
        // Global Color Table
        for (const c of palette) {
            bytes.push(c[0], c[1], c[2]);
        }
        
        // NETSCAPE extension for looping
        bytes.push(0x21, 0xFF, 0x0B);
        this.writeString(bytes, 'NETSCAPE2.0');
        bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);
        
        // Frames
        for (const frame of this.frames) {
            // Graphic Control Extension
            bytes.push(0x21, 0xF9, 0x04);
            bytes.push(0x09); // Disposal: restore to bg, transparent flag
            this.writeUint16(bytes, Math.round(frame.delay / 10));
            bytes.push(0); // Transparent color index
            bytes.push(0);
            
            // Image Descriptor
            bytes.push(0x2C);
            this.writeUint16(bytes, 0); // Left
            this.writeUint16(bytes, 0); // Top
            this.writeUint16(bytes, this.width);
            this.writeUint16(bytes, this.height);
            bytes.push(0); // No local color table
            
            // Image Data
            const indices = this.quantize(frame.imageData, palette);
            const compressed = this.lzwEncode(indices, 8);
            bytes.push(8); // Min code size
            
            // Write sub-blocks
            for (let i = 0; i < compressed.length; i += 255) {
                const chunk = compressed.slice(i, i + 255);
                bytes.push(chunk.length);
                bytes.push(...chunk);
            }
            bytes.push(0); // Block terminator
        }
        
        bytes.push(0x3B); // Trailer
        return new Uint8Array(bytes);
    }
    writeString(bytes, str) {
        for (let i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
    }
    
    writeUint16(bytes, val) {
        bytes.push(val & 0xFF, (val >> 8) & 0xFF);
    }
    buildPalette(pixels, maxColors) {
        if (pixels.length === 0) return [[128, 128, 128]];
        
        const boxes = [{ pixels: pixels.slice(0, 50000) }]; // 取樣
        
        while (boxes.length < maxColors) {
            let maxIdx = 0, maxLen = 0;
            for (let i = 0; i < boxes.length; i++) {
                if (boxes[i].pixels.length > maxLen) { maxLen = boxes[i].pixels.length; maxIdx = i; }
            }
            if (maxLen < 2) break;
            
            const box = boxes.splice(maxIdx, 1)[0];
            let maxRange = 0, splitCh = 0;
            for (let c = 0; c < 3; c++) {
                let min = 255, max = 0;
                for (const p of box.pixels) { min = Math.min(min, p[c]); max = Math.max(max, p[c]); }
                if (max - min > maxRange) { maxRange = max - min; splitCh = c; }
            }
            
            box.pixels.sort((a, b) => a[splitCh] - b[splitCh]);
            const mid = Math.floor(box.pixels.length / 2);
            boxes.push({ pixels: box.pixels.slice(0, mid) });
            boxes.push({ pixels: box.pixels.slice(mid) });
        }
        
        return boxes.map(box => {
            if (box.pixels.length === 0) return [128, 128, 128];
            let r = 0, g = 0, b = 0;
            for (const p of box.pixels) { r += p[0]; g += p[1]; b += p[2]; }
            const n = box.pixels.length;
            return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        });
    }
    quantize(imageData, palette) {
        const data = imageData.data;
        const indices = [];
        
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) {
                indices.push(0); // Transparent
            } else {
                let minDist = Infinity, bestIdx = 1;
                for (let j = 1; j < palette.length; j++) {
                    const dr = data[i] - palette[j][0];
                    const dg = data[i + 1] - palette[j][1];
                    const db = data[i + 2] - palette[j][2];
                    const dist = dr * dr + dg * dg + db * db;
                    if (dist < minDist) { minDist = dist; bestIdx = j; }
                }
                indices.push(bestIdx);
            }
        }
        return indices;
    }
    lzwEncode(indices, minCodeSize) {
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        
        const output = [];
        let bits = 0, bitCount = 0;
        
        const emit = (code, size) => {
            bits |= code << bitCount;
            bitCount += size;
            while (bitCount >= 8) {
                output.push(bits & 0xFF);
                bits >>= 8;
                bitCount -= 8;
            }
        };
        
        let codeSize = minCodeSize + 1;
        let nextCode = eoiCode + 1;
        const table = new Map();
        
        emit(clearCode, codeSize);
        
        let current = '';
        for (const idx of indices) {
            const next = current + ',' + idx;
            if (current === '') {
                current = '' + idx;
            } else if (table.has(next)) {
                current = next;
            } else {
                const code = current.includes(',') ? table.get(current) : parseInt(current);
                emit(code, codeSize);
                
                if (nextCode < 4096) {
                    table.set(next, nextCode++);
                    if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
                } else {
                    emit(clearCode, codeSize);
                    table.clear();
                    codeSize = minCodeSize + 1;
                    nextCode = eoiCode + 1;
                }
                current = '' + idx;
            }
        }
        
        if (current !== '') {
            const code = current.includes(',') ? table.get(current) : parseInt(current);
            emit(code, codeSize);
        }
        
        emit(eoiCode, codeSize);
        if (bitCount > 0) output.push(bits & 0xFF);
        
        return output;
    }
}
// ============ 主程式 ============
let gifData = null;
let resultBlob = null;
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const processBtn = document.getElementById('processBtn');
const downloadBtn = document.getElementById('downloadBtn');
const originalPreview = document.getElementById('originalPreview');
const resultPreview = document.getElementById('resultPreview');
const originalInfo = document.getElementById('originalInfo');
const resultInfo = document.getElementById('resultInfo');
const progress = document.getElementById('progress');
const progressBar = document.getElementById('progressBar');
const status = document.getElementById('status');
// 同步滑桿
['scale', 'color', 'tolerance'].forEach(name => {
    const range = document.getElementById(name + 'Range');
    const value = document.getElementById(name + 'Value');
    range.oninput = () => value.value = range.value;
    value.oninput = () => range.value = value.value;
});
// 跳幀選項變更時更新資訊
document.getElementById('frameSkip').onchange = updateFrameInfo;
function updateFrameInfo() {
    if (!gifData) return;
    const skip = parseInt(document.getElementById('frameSkip').value);
    const outputFrames = Math.ceil(gifData.frames.length / skip);
    document.getElementById('frameInfo').textContent = `(${gifData.frames.length} → ${outputFrames} 幀)`;
}
// 上傳
uploadArea.onclick = () => fileInput.click();
uploadArea.ondragover = e => { e.preventDefault(); uploadArea.classList.add('dragover'); };
uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
uploadArea.ondrop = e => { e.preventDefault(); uploadArea.classList.remove('dragover'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
fileInput.onchange = () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); };
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function loadFile(file) {
    if (!file.type.includes('gif')) { alert('請上傳 GIF 圖片'); return; }
    
    originalPreview.src = URL.createObjectURL(file);
    originalPreview.style.display = 'block';
    originalPreview.onload = () => {
        originalInfo.textContent = `${originalPreview.naturalWidth} x ${originalPreview.naturalHeight} | ${formatSize(file.size)}`;
    };
    
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const decoder = new GifDecoder(e.target.result);
            gifData = decoder.decode();
            processBtn.disabled = false;
            status.textContent = `已載入 ${gifData.frames.length} 幀`;
            updateFrameInfo();
        } catch (err) {
            alert('GIF 解析失敗: ' + err.message);
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
}
// 處理
processBtn.onclick = async () => {
    if (!gifData) return;
    
    const scale = parseInt(document.getElementById('scaleValue').value) / 100;
    const colorCount = parseInt(document.getElementById('colorValue').value);
    const enableRemoveBg = document.getElementById('enableRemoveBg').checked;
    const bgColor = document.getElementById('bgColor').value;
    const tolerance = parseInt(document.getElementById('toleranceValue').value);
    const frameSkip = parseInt(document.getElementById('frameSkip').value);
    
    const newWidth = Math.round(gifData.width * scale);
    const newHeight = Math.round(gifData.height * scale);
    
    processBtn.disabled = true;
    downloadBtn.style.display = 'none';
    progress.style.display = 'block';
    progressBar.style.width = '0%';
    status.textContent = '處理中...';
    
    const encoder = new GifEncoder(newWidth, newHeight);
    const canvas = document.createElement('canvas');
    canvas.width = newWidth;
    canvas.height = newHeight;
    const ctx = canvas.getContext('2d');
    
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = gifData.width;
    srcCanvas.height = gifData.height;
    const srcCtx = srcCanvas.getContext('2d');
    
    // 篩選要處理的幀
    const framesToProcess = [];
    for (let i = 0; i < gifData.frames.length; i += frameSkip) {
        // 累加跳過幀的延遲時間
        let totalDelay = 0;
        for (let j = i; j < Math.min(i + frameSkip, gifData.frames.length); j++) {
            totalDelay += gifData.frames[j].delay;
        }
        framesToProcess.push({
            frame: gifData.frames[i],
            delay: totalDelay
        });
    }
    
    // 計算縮放後的起始點座標,並確保在有效範圍內
    const scaledSeedPoints = seedPoints.map(p => ({
        x: Math.min(Math.max(0, Math.round(p.x * scale)), newWidth - 1),
        y: Math.min(Math.max(0, Math.round(p.y * scale)), newHeight - 1)
    }));
    
    for (let i = 0; i < framesToProcess.length; i++) {
        status.textContent = `處理幀 ${i + 1} / ${framesToProcess.length}`;
        progressBar.style.width = ((i + 1) / framesToProcess.length * 100) + '%';
        
        const { frame, delay } = framesToProcess[i];
        
        // 繪製原始幀
        const srcImgData = new ImageData(new Uint8ClampedArray(frame.imageData), gifData.width, gifData.height);
        srcCtx.putImageData(srcImgData, 0, 0);
        
        // 縮放
        ctx.clearRect(0, 0, newWidth, newHeight);
        ctx.drawImage(srcCanvas, 0, 0, newWidth, newHeight);
        
        let imageData = ctx.getImageData(0, 0, newWidth, newHeight);
        
        // 去背
        if (enableRemoveBg) {
            removeBackground(imageData, bgColor, tolerance, scaledSeedPoints);
        }
        
        // 減色
        reduceColors(imageData, colorCount);
        
        encoder.addFrame(imageData, delay);
        
        await new Promise(r => setTimeout(r, 5));
    }
    
    status.textContent = '編碼 GIF...';
    await new Promise(r => setTimeout(r, 10));
    
    try {
        const gifBytes = encoder.encode();
        resultBlob = new Blob([gifBytes], { type: 'image/gif' });
        
        resultPreview.src = URL.createObjectURL(resultBlob);
        resultPreview.style.display = 'block';
        resultInfo.textContent = `${newWidth} x ${newHeight} | ${formatSize(resultBlob.size)}`;
        
        downloadBtn.style.display = 'inline-block';
        status.textContent = '處理完成！';
    } catch (err) {
        status.textContent = '編碼失敗: ' + err.message;
        console.error(err);
    }
    
    processBtn.disabled = false;
    progress.style.display = 'none';
};
function removeBackground(imageData, targetColor, tolerance, seedPoints) {
    if (!seedPoints || seedPoints.length === 0) return;
    
    const { data, width, height } = imageData;
    
    // 將十六進制顏色轉換為 RGB
    const targetR = parseInt(targetColor.slice(1, 3), 16);
    const targetG = parseInt(targetColor.slice(3, 5), 16);
    const targetB = parseInt(targetColor.slice(5, 7), 16);
    
    // 檢查像素是否與目標顏色相似
    const isTargetColor = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        
        // 已經透明的不算目標顏色
        if (a === 0) return false;
        
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const diff = Math.sqrt(
            Math.pow(r - targetR, 2) + 
            Math.pow(g - targetG, 2) + 
            Math.pow(b - targetB, 2)
        );
        
        // tolerance 從 0-100 映射到 0-441 (sqrt(255^2 * 3))
        const maxDiff = (tolerance / 100) * 441;
        return diff <= maxDiff;
    };
    
    // 檢查像素是否可以穿透繼續擴散(透明像素或目標顏色)
    const canPassThrough = (x, y) => {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        
        // 透明像素可以穿透
        if (a === 0) return true;
        
        // 目標顏色也可以穿透
        return isTargetColor(x, y);
    };
    
    // 從指定的起始點開始進行 flood fill
    const flood = (startX, startY) => {
        // 每個起始點使用獨立的 visited 陣列,避免被其他區域阻擋
        const visited = new Uint8Array(width * height);
        
        // 如果起始點本身不是目標顏色,嘗試從周圍 5x5 區域找到第一個目標顏色像素
        let actualStartX = startX;
        let actualStartY = startY;
        let found = isTargetColor(startX, startY);
        
        if (!found) {
            // 在起始點周圍 5x5 範圍搜尋目標顏色
            searchLoop: for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const checkX = startX + dx;
                    const checkY = startY + dy;
                    if (isTargetColor(checkX, checkY)) {
                        actualStartX = checkX;
                        actualStartY = checkY;
                        found = true;
                        break searchLoop;
                    }
                }
            }
        }
        
        // 如果周圍都找不到目標顏色,放棄這個起始點
        if (!found) return;
        
        const stack = [[actualStartX, actualStartY]];
        
        while (stack.length > 0) {
            const [x, y] = stack.pop();
            
            // 邊界檢查
            if (x < 0 || x >= width || y < 0 || y >= height) continue;
            
            const key = y * width + x;
            // 已訪問過就跳過
            if (visited[key]) continue;
            visited[key] = 1;
            
            const idx = (y * width + x) * 4;
            const a = data[idx + 3];
            
            // 如果是透明像素,繼續擴散但不改變
            if (a === 0) {
                stack.push([x + 1, y]);
                stack.push([x - 1, y]);
                stack.push([x, y + 1]);
                stack.push([x, y - 1]);
                continue;
            }
            
            // 檢查是否為目標顏色
            if (isTargetColor(x, y)) {
                // 設為透明
                data[idx + 3] = 0;
                
                // 繼續向四個方向擴散
                stack.push([x + 1, y]);
                stack.push([x - 1, y]);
                stack.push([x, y + 1]);
                stack.push([x, y - 1]);
            }
            // 如果不是目標顏色且不透明,停止擴散(不加入 stack)
        }
    };
    
    // 從所有設定的起始點開始 flood fill
    for (const point of seedPoints) {
        const px = Math.round(point.x);
        const py = Math.round(point.y);
        
        flood(px, py);
    }
}
function reduceColors(imageData, colorCount) {
    const { data } = imageData;
    
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) pixels.push([data[i], data[i + 1], data[i + 2], i]);
    }
    
    if (pixels.length === 0) return;
    
    // Median cut
    const boxes = [{ pixels: pixels.map(p => [p[0], p[1], p[2]]) }];
    while (boxes.length < colorCount) {
        let maxIdx = 0, maxLen = 0;
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].pixels.length > maxLen) { maxLen = boxes[i].pixels.length; maxIdx = i; }
        }
        if (maxLen < 2) break;
        
        const box = boxes.splice(maxIdx, 1)[0];
        let maxRange = 0, splitCh = 0;
        for (let c = 0; c < 3; c++) {
            let min = 255, max = 0;
            for (const p of box.pixels) { min = Math.min(min, p[c]); max = Math.max(max, p[c]); }
            if (max - min > maxRange) { maxRange = max - min; splitCh = c; }
        }
        box.pixels.sort((a, b) => a[splitCh] - b[splitCh]);
        const mid = Math.floor(box.pixels.length / 2);
        boxes.push({ pixels: box.pixels.slice(0, mid) });
        boxes.push({ pixels: box.pixels.slice(mid) });
    }
    
    const palette = boxes.map(box => {
        if (box.pixels.length === 0) return [128, 128, 128];
        let r = 0, g = 0, b = 0;
        for (const p of box.pixels) { r += p[0]; g += p[1]; b += p[2]; }
        const n = box.pixels.length;
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
    
    // 映射到調色盤
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        let minDist = Infinity, bestColor = palette[0];
        for (const c of palette) {
            const dist = (data[i] - c[0]) ** 2 + (data[i + 1] - c[1]) ** 2 + (data[i + 2] - c[2]) ** 2;
            if (dist < minDist) { minDist = dist; bestColor = c; }
        }
        data[i] = bestColor[0];
        data[i + 1] = bestColor[1];
        data[i + 2] = bestColor[2];
    }
}
// 下載
downloadBtn.onclick = () => {
    if (!resultBlob) return;
    const a = document.createElement('a');
    const url = URL.createObjectURL(resultBlob);
    a.href = url;
    a.download = 'compressed.gif';
    a.click();
    // 釋放 Object URL 以避免記憶體洩漏
    setTimeout(() => URL.revokeObjectURL(url), 100);
};
// ============ 去背控制事件 ============
const enableRemoveBgEl = document.getElementById('enableRemoveBg');
const bgColorEl = document.getElementById('bgColor');
const bgColorDisplayEl = document.getElementById('bgColorDisplay');
const bgColorRow = document.getElementById('bgColorRow');
const toleranceRow = document.getElementById('toleranceRow');
const seedPointsRow = document.getElementById('seedPointsRow');
const addSeedPointBtn = document.getElementById('addSeedPointBtn');
const clearSeedPointsBtn = document.getElementById('clearSeedPointsBtn');
const useDefaultCornersBtn = document.getElementById('useDefaultCornersBtn');
// originalPreview 已在上方宣告，此處不需重複
// 更新去背相關控制項的顯示狀態
function updateRemoveBgControls() {
    const enabled = enableRemoveBgEl.checked;
    bgColorRow.style.display = enabled ? 'flex' : 'none';
    toleranceRow.style.display = enabled ? 'flex' : 'none';
    seedPointsRow.style.display = enabled ? 'flex' : 'none';
}
enableRemoveBgEl.addEventListener('change', updateRemoveBgControls);
updateRemoveBgControls();
// 顏色選擇器更新
bgColorEl.addEventListener('input', (e) => {
    bgColorDisplayEl.textContent = e.target.value;
});
// 起始點設定按鈕
addSeedPointBtn.addEventListener('click', toggleAddSeedPoints);
clearSeedPointsBtn.addEventListener('click', clearAllSeedPoints);
useDefaultCornersBtn.addEventListener('click', useDefaultCorners);
// 點擊圖片設定/移除起始點
originalPreview.addEventListener('click', (e) => {
    if (!isAddingSeedPoints) return;
    if (!originalPreview.naturalWidth) return;
    
    const rect = originalPreview.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 轉換為原圖座標
    const scaleX = originalPreview.naturalWidth / rect.width;
    const scaleY = originalPreview.naturalHeight / rect.height;
    const imgX = x * scaleX;
    const imgY = y * scaleY;
    
    // 檢查是否點擊到現有的點附近 (10px 範圍)
    const clickTolerance = 10;
    const existingIndex = seedPoints.findIndex(p => {
        const dx = Math.abs(p.x - imgX);
        const dy = Math.abs(p.y - imgY);
        return dx < clickTolerance * scaleX && dy < clickTolerance * scaleY;
    });
    
    if (existingIndex !== -1) {
        // 移除現有的點
        seedPoints.splice(existingIndex, 1);
    } else {
        // 新增點
        seedPoints.push({x: imgX, y: imgY});
    }
    
    updateSeedPointsDisplay();
});
// 圖片載入時更新標記點顯示
originalPreview.addEventListener('load', () => {
    updateSeedPointsDisplay();
});

// 視窗大小改變時更新標記點位置 (使用防抖避免頻繁觸發)
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(updateSeedPointsDisplay, 100);
});
