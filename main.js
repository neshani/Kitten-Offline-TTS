// This file assumes 'ort' and 'phonemize' are available from the scripts
// loaded in tts_app.html

import { phonemize } from './phonemizer-dist/phonemizer.js';

// --- Global Variables ---
let session = null;
let voices = null;
let isBusy = false;

// --- DOM Elements ---
const statusEl = document.getElementById('status');
const textInputArea = document.getElementById('text-input-area');
const textInputEl = document.getElementById('textInput');
const processingControls = document.getElementById('processing-controls');
const generateAllBtn = document.getElementById('generate-all-btn');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const audioList = document.getElementById('audio-list');
const voiceSelectEl = document.getElementById('voiceSelect');
const speedSliderEl = document.getElementById('speedSlider');


// --- MAIN INITIALIZATION ---

window.addEventListener('load', () => {
    loadModel();
    checkForSharedText();
});


// --- CORE FUNCTIONS ---

async function loadModel() {
    statusEl.className = 'status loading';
    statusEl.textContent = 'Loading AI model... (this may take a moment)';
    try {
        // --- THIS IS THE ROBUST FIX ---
        // Dynamically create the full, absolute path to the ort-dist directory.
        // This resolves all ambiguity for the ONNX library.
        const ortDistPath = new URL('ort-dist/', window.location.href).href;
        ort.env.wasm.wasmPaths = ortDistPath;
        
        session = await ort.InferenceSession.create('./model/kitten_tts_nano_v0_1.onnx');
        
        const voicesResponse = await fetch('./model/voices.json');
        const voicesData = await voicesResponse.json();

        voices = {}; 
        for (const [voiceName, voiceArray] of Object.entries(voicesData)) {
            const flatArray = Array.isArray(voiceArray[0]) ? voiceArray.flat() : voiceArray;
            voices[voiceName] = new Float32Array(flatArray);
        }
        
        statusEl.style.display = 'none';
        textInputArea.style.display = 'block';
        processingControls.style.display = 'block';

        generateAllBtn.onclick = () => {
            const textToProcess = textInputEl.value;
            if (!textToProcess.trim()) {
                alert("Please enter some text to generate audio.");
                return;
            }
            processAllChunks(textToProcess);
        };

    } catch (error) {
        console.error('Error loading model:', error);
        statusEl.className = 'status error';
        statusEl.textContent = `Error loading model: ${error.message}`;
    }
}

function checkForSharedText() {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedText = urlParams.get('text');

    if (sharedText) {
        textInputEl.value = sharedText;
    }
}

// --- REFACTORED for non-blocking UI and ETA ---
async function processAllChunks(fullText) {
    if (isBusy || !session) return;
    isBusy = true;
    generateAllBtn.disabled = true;
    audioList.innerHTML = ''; 
    progressLabel.textContent = 'Starting processing...';

    const chunks = splitIntoSentences(fullText).filter(c => c.trim() !== '');
    if (chunks.length === 0) {
        progressLabel.textContent = 'No text to process.';
        isBusy = false;
        generateAllBtn.disabled = false;
        return;
    }
    
    progressBar.value = 0;
    progressBar.max = chunks.length;

    const allAudioDataArrays = [];
    const chunkProcessingTimes = [];

    const processChunkAtIndex = async (index) => {
        if (index >= chunks.length) {
            // All chunks are done, pass them to the new finalize function.
            finalizeAudio(allAudioDataArrays);
            return;
        }

        const chunkText = chunks[index].trim();
        const startTime = performance.now();

        try {
            const rawAudioData = await generateRawAudioForChunk(chunkText);
            allAudioDataArrays.push(rawAudioData);
            
            const endTime = performance.now();
            const duration = (endTime - startTime) / 1000;
            chunkProcessingTimes.push(duration);

            updateProgress(index + 1, chunks.length, chunkProcessingTimes);

            setTimeout(() => processChunkAtIndex(index + 1), 0);

        } catch (error) {
            console.error(`Failed to process chunk: "${chunkText}"`, error);
            progressLabel.textContent = `Error: ${error.message}`;
            isBusy = false;
            generateAllBtn.disabled = false;
        }
    };

    // Start processing with the first chunk
    processChunkAtIndex(0);
}


// --- NEW FUNCTION with Crossfading Logic ---
function finalizeAudio(allAudioDataArrays) {
    progressLabel.textContent = "Combining audio with crossfading...";

    if (!allAudioDataArrays || allAudioDataArrays.length === 0) {
        progressLabel.textContent = "Processing finished, but no audio data was generated.";
        isBusy = false;
        generateAllBtn.disabled = false;
        return;
    }
    
    const SAMPLE_RATE = 24000;
    // Define the crossfade duration in milliseconds
    const FADE_DURATION_MS = 50; 
    // Calculate how many samples that duration corresponds to
    const fadeSamples = Math.floor(SAMPLE_RATE * (FADE_DURATION_MS / 1000));

    // Calculate the total length of the final audio, accounting for the overlaps
    const totalLength = allAudioDataArrays.reduce((sum, arr) => sum + arr.length, 0) - ((allAudioDataArrays.length - 1) * fadeSamples);
    
    const concatenatedAudio = new Float32Array(totalLength);
    let offset = 0;

    // First, copy the very first chunk directly into the buffer
    concatenatedAudio.set(allAudioDataArrays[0], offset);
    offset += allAudioDataArrays[0].length;

    // Now, loop through the rest of the chunks and apply the crossfade
    for (let i = 1; i < allAudioDataArrays.length; i++) {
        const currentChunk = allAudioDataArrays[i];
        
        // The offset where we start the overlap
        let crossfadeOffset = offset - fadeSamples;

        // Apply the crossfade
        for (let j = 0; j < fadeSamples; j++) {
            // Get the sample from the end of the previous chunk (already in our buffer)
            const sampleA = concatenatedAudio[crossfadeOffset + j];
            // Get the sample from the beginning of the new chunk
            const sampleB = currentChunk[j];

            // Calculate the gain for the fade-out and fade-in
            const fadeOutGain = 1.0 - (j / fadeSamples);
            const fadeInGain = j / fadeSamples;

            // Mix the two samples
            concatenatedAudio[crossfadeOffset + j] = (sampleA * fadeOutGain) + (sampleB * fadeInGain);
        }
        
        // Copy the rest of the new chunk (after the fade-in part)
        const remainingPartOfChunk = currentChunk.subarray(fadeSamples);
        concatenatedAudio.set(remainingPartOfChunk, offset);
        
        // Update the offset for the next chunk
        offset += remainingPartOfChunk.length;
    }


    const finalAudioBlob = audioBufferToWavBlob(concatenatedAudio, SAMPLE_RATE);
    createFinalAudioPlayer(finalAudioBlob);
    
    progressLabel.textContent = "Full audio file created successfully!";
    isBusy = false;
    generateAllBtn.disabled = false;
}

function updateProgress(completed, total, times) {
    progressBar.value = completed;
    
    // Calculate ETA
    const totalTime = times.reduce((a, b) => a + b, 0);
    const avgTimePerChunk = totalTime / times.length;
    const remainingChunks = total - completed;
    const etaSeconds = Math.round(avgTimePerChunk * remainingChunks);
    const eta = formatTime(etaSeconds);
    
    progressLabel.textContent = `Processing sentence ${completed} of ${total}... (ETA: ${eta})`;
}


async function generateRawAudioForChunk(text) {
    const phonemesList = await phonemize(text, 'en-us');
    
    const allPhonemes = Array.isArray(phonemesList) ? phonemesList.join(' ') : phonemesList;
    const phonemeTokens = allPhonemes.split(/\s+/).filter(token => token.length > 0);
    const phonemeString = phonemeTokens.join(' ');

    const textCleaner = new TextCleaner();
    let tokenIds = textCleaner.clean(phonemeString);
    tokenIds.unshift(0);
    tokenIds.push(0);
    
    const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokenIds.map(id => BigInt(id))), [1, tokenIds.length]);

    const selectedVoice = voiceSelectEl.value;
    const speed = parseFloat(speedSliderEl.value);

    const voiceData = voices[selectedVoice];
    if (!voiceData) {
        throw new Error(`Voice data for '${selectedVoice}' could not be found. Check voices.json.`);
    }

    const style = new ort.Tensor('float32', voiceData, [1, voiceData.length]);
    const speedTensor = new ort.Tensor('float32', new Float32Array([speed]), [1]);

    const feeds = { 'input_ids': inputIds, 'style': style, 'speed': speedTensor };

    const results = await session.run(feeds);
    return results[Object.keys(results)[0]].data;
}

function createFinalAudioPlayer(audioBlob) {
    const audioUrl = URL.createObjectURL(audioBlob);

    const listItem = document.createElement('li');
    listItem.style.listStyle = 'none';
    listItem.style.border = '1px solid #007bff';
    listItem.style.padding = '15px';
    listItem.style.borderRadius = '8px';
    listItem.style.marginTop = '15px';

    const header = document.createElement('strong');
    header.textContent = `Full Audiobook`;
    header.style.fontSize = '1.2em';

    const audioPlayer = document.createElement('audio');
    audioPlayer.src = audioUrl;
    audioPlayer.controls = true;
    audioPlayer.style.width = '100%';
    audioPlayer.style.marginTop = '10px';

    const downloadLink = document.createElement('a');
    downloadLink.href = audioUrl;
    downloadLink.download = `full_audiobook.wav`;
    downloadLink.textContent = 'Download Full Audio (.wav)';
    downloadLink.style.display = 'inline-block';
    downloadLink.style.marginTop = '10px';

    listItem.appendChild(header);
    listItem.appendChild(audioPlayer);
    listItem.appendChild(document.createElement('br'));
    listItem.appendChild(downloadLink);
    
    audioList.appendChild(listItem);
}


// --- UTILITY FUNCTIONS ---

/**
 * Formats seconds into a mm:ss string for the ETA.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) {
        return "N/A";
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    const paddedSeconds = String(remainingSeconds).padStart(2, '0');
    return `${minutes}:${paddedSeconds}`;
}

/**
 * Splits a block of text into an array of sentences.
 * @param {string} text The full text to split.
 * @returns {string[]} An array of sentences.
 */
function splitIntoSentences(text) {
    if (!text) return [];
    // This regex matches sentence-ending punctuation (. ! ?)
    // and splits the text there, keeping the punctuation.
    const sentences = text.match(/[^.!?]+[.!?]*|[^.!?]+$/g);
    return sentences || [];
}

class TextCleaner {
    constructor() {
        const _pad = "$";
        const _punctuation = ';:,.!?¡¿—…"«»"" ';
        const _letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        const _letters_ipa = "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̩'ᵻ";
        
        const symbols = [_pad, ...Array.from(_punctuation), ...Array.from(_letters), ...Array.from(_letters_ipa)];
        
        this.wordIndexDictionary = {};
        symbols.forEach((symbol, i) => {
            this.wordIndexDictionary[symbol] = i;
        });
    }
    
    clean(text) {
        const indexes = [];
        for (const char of text) {
            if (this.wordIndexDictionary[char] !== undefined) {
                indexes.push(this.wordIndexDictionary[char]);
            }
        }
        return indexes;
    }
}

function audioBufferToWavBlob(audioData, sampleRate) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
    const audioBuffer = audioContext.createBuffer(1, audioData.length, sampleRate);
    audioBuffer.getChannelData(0).set(audioData);

    const length = audioBuffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    const channelData = audioBuffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
    }
    
    return new Blob([view], { type: 'audio/wav' });
}