document.addEventListener('DOMContentLoaded', () => {
    // --- Global DOM Elements ---
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const statusDiv = document.getElementById('audio-status');
    const body = document.body;

    // --- Audio System Variables ---
    let audioContext;
    let mainGainNode;
    let activeNodes = {}; // Tracks dynamic nodes for advanced waveforms
    
    const attackTime = 0.01;
    const releaseTime = 0.01;

    // --- Advanced Waveform Constants ---
    const FM_MODULATOR_RATIO = 1.4;
    const FM_MODULATION_INDEX_SCALE = 2.0;
    const AM_MODULATOR_FREQ = 7;
    const AM_MODULATION_DEPTH = 0.7;
    const RING_MOD_RATIO = 0.78;
    const PWM_REAL_COEFFS = new Float32Array([0, 0.8, 0.8, 0.4, 0, -0.4, -0.8, -0.8]);
    const PWM_IMAG_COEFFS = new Float32Array(PWM_REAL_COEFFS.length).fill(0);
    let pwmPeriodicWave = null;

    // --- State ---
    let isPlaying = false;
    let stopRequested = false;

    // --- Morse Code Dictionary ---
    const MORSE_DICT = {
        'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
        'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
        'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
        'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
        'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
        '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
        '9': '----.', '0': '-----', ' ': ' '
    };
    const REVERSE_MORSE = Object.entries(MORSE_DICT).reduce((acc, [k, v]) => { acc[v] = k; return acc; }, {});

    // --- Dark Mode ---
    function setDarkMode(enabled) {
        if (enabled) {
            body.classList.remove('light-mode');
            darkModeToggle.textContent = '☀️ Light Mode';
        } else {
            body.classList.add('light-mode');
            darkModeToggle.textContent = '🌙 Dark Mode';
        }
    }
    darkModeToggle.addEventListener('click', () => setDarkMode(body.classList.contains('light-mode')));

    // --- Web Audio Synthesizer Graph ---
    function rebuildAudioGraph() {
        if (!audioContext || audioContext.state !== 'running') return;

        // Clean up old nodes
        if (activeNodes.carrierOsc) { activeNodes.carrierOsc.stop(); activeNodes.carrierOsc.disconnect(); }
        if (activeNodes.modulatorOsc1) { activeNodes.modulatorOsc1.stop(); activeNodes.modulatorOsc1.disconnect(); }
        if (activeNodes.dcOffsetNodeAM) { activeNodes.dcOffsetNodeAM.stop(); activeNodes.dcOffsetNodeAM.disconnect(); }
        activeNodes = {};

        const type = document.getElementById('synth-waveform').value;
        const freq = parseFloat(document.getElementById('synth-freq').value);
        const now = audioContext.currentTime;

        activeNodes.carrierOsc = audioContext.createOscillator();
        activeNodes.carrierOsc.frequency.setValueAtTime(freq, now);

        if (!pwmPeriodicWave && type === 'pwm') {
            pwmPeriodicWave = audioContext.createPeriodicWave(PWM_REAL_COEFFS, PWM_IMAG_COEFFS, { disableNormalization: false });
        }

        switch (type) {
            case 'sine': case 'square': case 'sawtooth': case 'triangle':
                activeNodes.carrierOsc.type = type;
                activeNodes.carrierOsc.connect(mainGainNode);
                break;
            case 'pwm':
                activeNodes.carrierOsc.setPeriodicWave(pwmPeriodicWave);
                activeNodes.carrierOsc.connect(mainGainNode);
                break;
            case 'fm':
                activeNodes.carrierOsc.type = 'sine';
                activeNodes.modulatorOsc1 = audioContext.createOscillator();
                activeNodes.modulatorOsc1.type = 'sine';
                activeNodes.modulatorOsc1.frequency.setValueAtTime(freq * FM_MODULATOR_RATIO, now);
                activeNodes.modGain1 = audioContext.createGain();
                activeNodes.modGain1.gain.setValueAtTime(freq * FM_MODULATION_INDEX_SCALE, now);

                activeNodes.modulatorOsc1.connect(activeNodes.modGain1);
                activeNodes.modGain1.connect(activeNodes.carrierOsc.frequency);
                activeNodes.carrierOsc.connect(mainGainNode);
                activeNodes.modulatorOsc1.start();
                break;
            case 'am':
                activeNodes.carrierOsc.type = 'sine';
                activeNodes.modulatorOsc1 = audioContext.createOscillator();
                activeNodes.modulatorOsc1.type = 'sine';
                activeNodes.modulatorOsc1.frequency.setValueAtTime(AM_MODULATOR_FREQ, now);

                activeNodes.dcOffsetNodeAM = audioContext.createConstantSource();
                activeNodes.dcOffsetNodeAM.offset.value = 1.0 - (AM_MODULATION_DEPTH / 2);

                activeNodes.modulatorScaleGainAM = audioContext.createGain();
                activeNodes.modulatorScaleGainAM.gain.value = AM_MODULATION_DEPTH / 2;

                activeNodes.modGain1 = audioContext.createGain();

                activeNodes.modulatorOsc1.connect(activeNodes.modulatorScaleGainAM);
                activeNodes.dcOffsetNodeAM.connect(activeNodes.modGain1.gain);
                activeNodes.modulatorScaleGainAM.connect(activeNodes.modGain1.gain);
                activeNodes.carrierOsc.connect(activeNodes.modGain1);
                activeNodes.modGain1.connect(mainGainNode);

                activeNodes.modulatorOsc1.start();
                activeNodes.dcOffsetNodeAM.start();
                break;
            case 'ring':
                activeNodes.carrierOsc.type = 'sine';
                activeNodes.modulatorOsc1 = audioContext.createOscillator();
                activeNodes.modulatorOsc1.type = 'sine';
                activeNodes.modulatorOsc1.frequency.setValueAtTime(freq * RING_MOD_RATIO, now);

                activeNodes.modGain1 = audioContext.createGain();

                activeNodes.modulatorOsc1.connect(activeNodes.modGain1.gain);
                activeNodes.carrierOsc.connect(activeNodes.modGain1);
                activeNodes.modGain1.connect(mainGainNode);
                activeNodes.modulatorOsc1.start();
                break;
        }

        activeNodes.carrierOsc.start();
    }

    function updateFrequency(freq) {
        if (!activeNodes.carrierOsc) return;
        const now = audioContext.currentTime;
        const type = document.getElementById('synth-waveform').value;

        activeNodes.carrierOsc.frequency.setValueAtTime(freq, now);

        if (type === 'fm' && activeNodes.modulatorOsc1 && activeNodes.modGain1) {
            activeNodes.modulatorOsc1.frequency.setValueAtTime(freq * FM_MODULATOR_RATIO, now);
            activeNodes.modGain1.gain.setValueAtTime(freq * FM_MODULATION_INDEX_SCALE, now);
        } else if (type === 'ring' && activeNodes.modulatorOsc1) {
            activeNodes.modulatorOsc1.frequency.setValueAtTime(freq * RING_MOD_RATIO, now);
        }
    }

    function initAudio() {
        if (audioContext && audioContext.state === 'running') return Promise.resolve();
        return new Promise((resolve) => {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                mainGainNode = audioContext.createGain();
                mainGainNode.gain.value = 0;
                mainGainNode.connect(audioContext.destination);
                
                // Start background oscillators with volume at 0
                rebuildAudioGraph();
            }
            audioContext.resume().then(() => {
                statusDiv.textContent = "Audio Ready";
                statusDiv.className = 'ready';
                resolve();
            });
        });
    }

    // Initialize Audio on any click
    document.body.addEventListener('click', () => {
        if (!audioContext || audioContext.state !== 'running') initAudio();
    }, { once: true });

    // --- Tone Control ---
    function toneOn() {
        if (!audioContext) return;
        const vol = parseFloat(document.getElementById('synth-volume').value);
        mainGainNode.gain.cancelScheduledValues(audioContext.currentTime);
        mainGainNode.gain.setTargetAtTime(vol, audioContext.currentTime, attackTime);
    }

    function toneOff() {
        if (!audioContext) return;
        mainGainNode.gain.cancelScheduledValues(audioContext.currentTime);
        mainGainNode.gain.setTargetAtTime(0, audioContext.currentTime, releaseTime);
    }

    // --- Settings Listeners ---
    document.getElementById('synth-waveform').addEventListener('change', () => {
        rebuildAudioGraph();
    });

    document.getElementById('synth-freq').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('freq-val').textContent = val;
        updateFrequency(val);
    });

    document.getElementById('synth-wpm').addEventListener('input', (e) => {
        document.getElementById('wpm-val').textContent = e.target.value;
    });

    // --- Encoder Logic (Text to Sound) ---
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function playMorseSequence(text) {
        if (isPlaying) return;
        isPlaying = true;
        stopRequested = false;
        await initAudio();

        const visualDiv = document.getElementById('morse-visual-display');
        visualDiv.innerHTML = '';
        const wpm = parseFloat(document.getElementById('synth-wpm').value);
        const dotMs = 1200 / wpm; // Standard formula: 1 unit = 1.2 / WPM seconds
        
        let chars = text.toUpperCase().split('');
        
        // Render visual spans
        let spans = [];
        chars.forEach(char => {
            const code = MORSE_DICT[char];
            if (code) {
                if (code === ' ') {
                    let sp = document.createElement('span');
                    sp.textContent = '   '; // Visual word space
                    visualDiv.appendChild(sp);
                    spans.push({ char, code: ' ', element: sp });
                } else {
                    for (let sym of code) {
                        let sp = document.createElement('span');
                        sp.textContent = sym;
                        visualDiv.appendChild(sp);
                        spans.push({ char, code: sym, element: sp });
                    }
                    let letterSpace = document.createElement('span');
                    letterSpace.textContent = ' ';
                    visualDiv.appendChild(letterSpace);
                    spans.push({ char: null, code: 'letter_space', element: letterSpace });
                }
            }
        });

        // Play sequence
        for (let i = 0; i < spans.length; i++) {
            if (stopRequested) break;
            const item = spans[i];
            
            if (item.code === '.' || item.code === '-') {
                item.element.classList.add('active');
                toneOn();
                await sleep(item.code === '.' ? dotMs : dotMs * 3);
                toneOff();
                item.element.classList.remove('active');
                await sleep(dotMs); // intra-character space
            } else if (item.code === 'letter_space') {
                await sleep(dotMs * 2); // 3 total (1 from above + 2)
            } else if (item.code === ' ') {
                await sleep(dotMs * 6); // 7 total (1 from above + 6)
            }
        }
        
        isPlaying = false;
        if (document.getElementById('loop-checkbox').checked && !stopRequested) {
            playMorseSequence(text); // Loop
        }
    }

    // Encoder Controls
    document.getElementById('play-btn').addEventListener('click', () => {
        playMorseSequence(document.getElementById('text-input').value);
    });
    
    document.getElementById('stop-btn').addEventListener('click', () => {
        stopRequested = true;
        toneOff();
    });

    // Live Typing Setup
    document.getElementById('text-input').addEventListener('input', (e) => {
        const newChar = e.data;
        if (!isPlaying && newChar && MORSE_DICT[newChar.toUpperCase()]) {
            playMorseSequence(newChar.toUpperCase());
        }
    });

    // --- Decoder Logic (Mic Audio to Text) ---
    let micStream;
    let analyser;
    let decodeAnimationFrame;
    let decodingActive = false;
    
    const startMicBtn = document.getElementById('start-mic-btn');
    const stopMicBtn = document.getElementById('stop-mic-btn');
    const signalLevel = document.getElementById('signal-level');
    const decodedTextDisplay = document.getElementById('decoded-text');

    async function startDecoding() {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            await initAudio(); // Need context running
            
            const micSource = audioContext.createMediaStreamSource(micStream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            micSource.connect(analyser);
            
            decodingActive = true;
            startMicBtn.disabled = true;
            stopMicBtn.disabled = false;
            decodedTextDisplay.textContent = "";
            analyzeIncomingSignal();
        } catch (err) {
            alert("Microphone access denied or error occurred.");
            console.error(err);
        }
    }

    function stopDecoding() {
        decodingActive = false;
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(decodeAnimationFrame);
        startMicBtn.disabled = false;
        stopMicBtn.disabled = true;
        signalLevel.style.width = '0%';
    }

    startMicBtn.addEventListener('click', startDecoding);
    stopMicBtn.addEventListener('click', stopDecoding);

    // Decoding State Machine
    let isToneCurrentlyOn = false;
    let lastStateChangeTime = performance.now();
    let currentSymbolBuffer = "";
    
    function analyzeIncomingSignal() {
        if (!decodingActive) return;

        const dataArray = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(dataArray);

        // Find max energy in the buffer (rough volume estimation for tone)
        let maxEnergy = -100;
        for(let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxEnergy) maxEnergy = dataArray[i];
        }

        // Update UI meter
        const meterPercent = Math.max(0, Math.min(100, (maxEnergy + 100) * 1.5));
        signalLevel.style.width = `${meterPercent}%`;

        const threshold = parseFloat(document.getElementById('mic-threshold').value);
        const wpm = parseFloat(document.getElementById('synth-wpm').value);
        const dotMs = 1200 / wpm;

        const toneDetected = maxEnergy > threshold;
        const now = performance.now();
        const duration = now - lastStateChangeTime;

        if (toneDetected !== isToneCurrentlyOn) {
            // State changed
            if (!toneDetected) {
                // Tone just ended. Was it a dot or dash?
                if (duration > dotMs * 2) { // Allow margin of error
                    currentSymbolBuffer += "-";
                } else if (duration > dotMs * 0.3) { // Debounce noise
                    currentSymbolBuffer += ".";
                }
            }
            isToneCurrentlyOn = toneDetected;
            lastStateChangeTime = now;
        } else if (!toneDetected && currentSymbolBuffer.length > 0) {
            // Tone is off. Check for spaces
            if (duration > dotMs * 5) {
                // Word space
                const char = REVERSE_MORSE[currentSymbolBuffer];
                if (char) decodedTextDisplay.textContent += char + " ";
                else decodedTextDisplay.textContent += "? ";
                currentSymbolBuffer = "";
            } else if (duration > dotMs * 2.5) {
                // Character space
                const char = REVERSE_MORSE[currentSymbolBuffer];
                if (char) decodedTextDisplay.textContent += char;
                else decodedTextDisplay.textContent += "?";
                currentSymbolBuffer = "";
                lastStateChangeTime = now; // reset to avoid immediate word space triggers
            }
        }

        decodeAnimationFrame = requestAnimationFrame(analyzeIncomingSignal);
    }
});
