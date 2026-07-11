document.addEventListener('DOMContentLoaded', () => {
    // --- Global DOM Elements ---
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const statusDiv = document.getElementById('audio-status');
    const body = document.body;
    const mobileToggleBtn = document.getElementById('mobile-btn');
    const screenElement = document.getElementById("app-screen");

    // --- FULLSCREEN SCALING LOGIC ---
    function scaleApp() {
        const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
        
        if (isFullscreen) {
            const baseWidth = 850;
            const baseHeight = 950;
            
            const scale = Math.min(
                window.innerWidth / baseWidth,
                window.innerHeight / baseHeight
            );
            
            screenElement.style.transform = `scale(${scale})`;
            document.body.classList.add('mobile-mode');
        } else {
            screenElement.style.transform = 'none'; 
            document.body.classList.remove('mobile-mode');
        }
    }

    // Requests full screen
    function goFull() {
        const el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }

    window.addEventListener("resize", scaleApp);
    window.addEventListener("fullscreenchange", scaleApp);
    window.addEventListener("webkitfullscreenchange", scaleApp);

    if (mobileToggleBtn) {
        mobileToggleBtn.addEventListener('click', goFull);
    }
    scaleApp(); 

    // --- Audio System Variables ---
    let audioContext;
    let activeVoices = [];
    let activeTimeouts = [];
    let pwmPeriodicWave = null;

    // --- Advanced Waveform Constants ---
    const FM_MODULATOR_RATIO = 1.4;
    const FM_MODULATION_INDEX_SCALE = 2.0;
    const AM_MODULATOR_FREQ = 7;
    const AM_MODULATION_DEPTH = 0.7;
    const RING_MOD_RATIO = 0.78;
    const PWM_REAL_COEFFS = new Float32Array([0, 0.8, 0.8, 0.4, 0, -0.4, -0.8, -0.8]);
    const PWM_IMAG_COEFFS = new Float32Array(PWM_REAL_COEFFS.length).fill(0);

    // --- State ---
    let isPlaying = false;
    let stopRequested = false;
    let schedulerInterval = null;

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

    // --- Web Audio Synthesizer Graph (Stateless Voice Architecture) ---
    function createVoice(startTime, duration) {
        if (!audioContext || audioContext.state !== 'running') return null;

        const type = document.getElementById('synth-waveform').value;
        const freq = parseFloat(document.getElementById('synth-freq').value);
        const vol = parseFloat(document.getElementById('synth-volume').value);

        const voiceGain = audioContext.createGain();
        voiceGain.connect(audioContext.destination);

        // Dynamic attack/release scaling
        const att = Math.min(0.003, duration * 0.08); // Snappy 3ms attack
        const rel = Math.min(0.005, duration * 0.12); // Snappy 5ms release

        voiceGain.gain.setValueAtTime(0, startTime);
        voiceGain.gain.linearRampToValueAtTime(vol, startTime + att);
        voiceGain.gain.setValueAtTime(vol, startTime + duration - rel);
        voiceGain.gain.linearRampToValueAtTime(0, startTime + duration);

        const carrierOsc = audioContext.createOscillator();
        carrierOsc.frequency.setValueAtTime(freq, startTime);

        let modulatorOsc = null;
        let dcOffsetNodeAM = null;
        let modulatorScaleGainAM = null;
        let modGain = null;

        if (!pwmPeriodicWave && type === 'pwm') {
            pwmPeriodicWave = audioContext.createPeriodicWave(PWM_REAL_COEFFS, PWM_IMAG_COEFFS, { disableNormalization: false });
        }

        switch (type) {
            case 'sine': case 'square': case 'sawtooth': case 'triangle':
                carrierOsc.type = type;
                carrierOsc.connect(voiceGain);
                break;
            case 'pwm':
                carrierOsc.setPeriodicWave(pwmPeriodicWave);
                carrierOsc.connect(voiceGain);
                break;
            case 'fm':
                carrierOsc.type = 'sine';
                modulatorOsc = audioContext.createOscillator();
                modulatorOsc.type = 'sine';
                modulatorOsc.frequency.setValueAtTime(freq * FM_MODULATOR_RATIO, startTime);
                modGain = audioContext.createGain();
                modGain.gain.setValueAtTime(freq * FM_MODULATION_INDEX_SCALE, startTime);

                modulatorOsc.connect(modGain);
                modGain.connect(carrierOsc.frequency);
                carrierOsc.connect(voiceGain);
                modulatorOsc.start(startTime);
                modulatorOsc.stop(startTime + duration);
                break;
            case 'am':
                carrierOsc.type = 'sine';
                modulatorOsc = audioContext.createOscillator();
                modulatorOsc.type = 'sine';
                modulatorOsc.frequency.setValueAtTime(AM_MODULATOR_FREQ, startTime);

                dcOffsetNodeAM = audioContext.createConstantSource();
                dcOffsetNodeAM.offset.setValueAtTime(1.0 - (AM_MODULATION_DEPTH / 2), startTime);

                modulatorScaleGainAM = audioContext.createGain();
                modulatorScaleGainAM.gain.setValueAtTime(AM_MODULATION_DEPTH / 2, startTime);

                modGain = audioContext.createGain();

                modulatorOsc.connect(modulatorScaleGainAM);
                dcOffsetNodeAM.connect(modGain.gain);
                modulatorScaleGainAM.connect(modGain.gain);
                carrierOsc.connect(modGain);
                modGain.connect(voiceGain);

                modulatorOsc.start(startTime);
                modulatorOsc.stop(startTime + duration);
                dcOffsetNodeAM.start(startTime);
                dcOffsetNodeAM.stop(startTime + duration);
                break;
            case 'ring':
                carrierOsc.type = 'sine';
                modulatorOsc = audioContext.createOscillator();
                modulatorOsc.type = 'sine';
                modulatorOsc.frequency.setValueAtTime(freq * RING_MOD_RATIO, startTime);

                modGain = audioContext.createGain();

                modulatorOsc.connect(modGain.gain);
                carrierOsc.connect(modGain);
                modGain.connect(voiceGain);
                modulatorOsc.start(startTime);
                modulatorOsc.stop(startTime + duration);
                break;
        }

        carrierOsc.start(startTime);
        carrierOsc.stop(startTime + duration);

        // Safe cleanup when notes finish playing
        carrierOsc.onended = () => {
            try {
                carrierOsc.disconnect();
                voiceGain.disconnect();
                if (modulatorOsc) modulatorOsc.disconnect();
                if (dcOffsetNodeAM) dcOffsetNodeAM.disconnect();
                if (modulatorScaleGainAM) modulatorScaleGainAM.disconnect();
                if (modGain) modGain.disconnect();
            } catch(e){}
        };

        const voiceObj = {
            carrier: carrierOsc,
            modulator: modulatorOsc,
            type: type,
            stop: () => {
                try { carrierOsc.stop(); } catch(e){}
                if (modulatorOsc) { try { modulatorOsc.stop(); } catch(e){} }
                if (dcOffsetNodeAM) { try { dcOffsetNodeAM.stop(); } catch(e){} }
            }
        };

        return voiceObj;
    }

    function updateFrequency(freq) {
        if (!audioContext) return;
        const now = audioContext.currentTime;
        activeVoices.forEach(voice => {
            if (voice && voice.carrier) {
                try {
                    voice.carrier.frequency.setValueAtTime(freq, now);
                    if (voice.type === 'fm' && voice.modulator) {
                        voice.modulator.frequency.setValueAtTime(freq * FM_MODULATOR_RATIO, now);
                    } else if (voice.type === 'ring' && voice.modulator) {
                        voice.modulator.frequency.setValueAtTime(freq * RING_MOD_RATIO, now);
                    }
                } catch(e){}
            }
        });
    }

    function stopAllVoices() {
        activeVoices.forEach(voice => {
            if (voice && typeof voice.stop === 'function') {
                voice.stop();
            }
        });
        activeVoices = [];
    }

    // --- Settings Listeners & Frequency Unlock Configuration ---
    const synthFreqInput = document.getElementById('synth-freq');
    const freqValDisplay = document.getElementById('freq-val');
    const freqUnlockCheckbox = document.getElementById('freq-unlock');

    synthFreqInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        freqValDisplay.textContent = val;
        updateFrequency(val);
    });

    freqUnlockCheckbox.addEventListener('change', (e) => {
        const unlocked = e.target.checked;
        if (unlocked) {
            synthFreqInput.min = "50";
            synthFreqInput.max = "8000";
        } else {
            synthFreqInput.min = "200";
            synthFreqInput.max = "1200";
            
            // Clamp value if it went outside the standard limits while unlocked
            let val = parseFloat(synthFreqInput.value);
            if (val < 200) {
                val = 200;
            } else if (val > 1200) {
                val = 1200;
            }
            synthFreqInput.value = val;
            freqValDisplay.textContent = val;
            updateFrequency(val);
        }
    });

    document.getElementById('synth-wpm').addEventListener('input', (e) => {
        document.getElementById('wpm-val').textContent = e.target.value;
    });

    // --- Timeouts & Initialization Helpers ---
    function clearAllTimeouts() {
        activeTimeouts.forEach(t => clearTimeout(t));
        activeTimeouts = [];
    }

    function initAudio() {
        if (audioContext && audioContext.state === 'running') return Promise.resolve();
        return new Promise((resolve) => {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            audioContext.resume().then(() => {
                statusDiv.textContent = "Audio Ready";
                statusDiv.className = 'ready';
                resolve();
            });
        });
    }

    // Resume Audio Context on initial user interaction
    document.body.addEventListener('click', () => {
        if (!audioContext || audioContext.state !== 'running') initAudio();
    }, { once: true });

    // --- Encoder Logic (Text to Sound) with Lookahead Scheduler ---
    async function playMorseSequence(text) {
        if (isPlaying) return;
        isPlaying = true;
        stopRequested = false;
        await initAudio();

        const visualDiv = document.getElementById('morse-visual-display');
        visualDiv.innerHTML = '';
        const wpm = parseFloat(document.getElementById('synth-wpm').value);
        const dotMs = 1200 / wpm;
        const dotSec = dotMs / 1000;
        
        let chars = text.toUpperCase().split('');
        let timeline = [];
        let currentTimeOffset = 0.05; // Timing safe offset

        chars.forEach(char => {
            const code = MORSE_DICT[char];
            if (code) {
                if (code === ' ') {
                    currentTimeOffset += dotSec * 4;
                    let sp = document.createElement('span');
                    sp.style.display = 'inline-block';
                    sp.style.width = '1.5ch'; 
                    visualDiv.appendChild(sp);
                    timeline.push({ type: 'space', element: sp, time: currentTimeOffset });
                } else {
                    for (let sym of code) {
                        const duration = (sym === '.' ? dotSec : dotSec * 3);
                        let sp = document.createElement('span');
                        sp.textContent = sym;
                        visualDiv.appendChild(sp);
                        
                        timeline.push({
                            type: 'sound',
                            symbol: sym,
                            element: sp,
                            time: currentTimeOffset,
                            duration: duration
                        });
                        currentTimeOffset += duration;
                        currentTimeOffset += dotSec;
                    }
                    currentTimeOffset += dotSec * 2;
                    let letterSpace = document.createElement('span');
                    letterSpace.style.display = 'inline-block';
                    letterSpace.style.width = '0.5ch';
                    visualDiv.appendChild(letterSpace);
                    timeline.push({ type: 'letter_space', element: letterSpace, time: currentTimeOffset });
                }
            }
        });

        const totalDurationSec = currentTimeOffset;
        const startTime = audioContext.currentTime;
        let nextNoteIndex = 0;

        // Lookahead timing settings
        const lookahead = 0.1; // 100ms
        
        function schedulerTick() {
            if (stopRequested) {
                clearInterval(schedulerInterval);
                return;
            }

            const contextTime = audioContext.currentTime;

            while (nextNoteIndex < timeline.length) {
                const note = timeline[nextNoteIndex];
                const absoluteTime = startTime + note.time;

                if (absoluteTime < contextTime + lookahead) {
                    // Schedule Audio play event
                    if (note.type === 'sound') {
                        const voice = createVoice(absoluteTime, note.duration);
                        if (voice) {
                            activeVoices.push(voice);
                        }
                    }

                    // Schedule Visual highlight timing
                    const delayMs = (absoluteTime - contextTime) * 1000;

                    let tOn = setTimeout(() => {
                        note.element.classList.add('active');
                    }, Math.max(0, delayMs));

                    let tOff = setTimeout(() => {
                        note.element.classList.remove('active');
                    }, Math.max(0, delayMs + (note.duration * 1000)));

                    activeTimeouts.push(tOn, tOff);
                    nextNoteIndex++;
                } else {
                    break;
                }
            }

            if (nextNoteIndex >= timeline.length) {
                clearInterval(schedulerInterval);
                
                // Done timing callback
                const remainingTimeMs = ((startTime + totalDurationSec) - audioContext.currentTime) * 1000;
                let doneTimeout = setTimeout(() => {
                    isPlaying = false;
                    activeVoices = [];
                    
                    if (document.getElementById('loop-checkbox').checked && !stopRequested && document.getElementById('text-input').value.trim() !== '') {
                        playMorseSequence(document.getElementById('text-input').value); 
                    }
                }, Math.max(0, remainingTimeMs + 50));

                activeTimeouts.push(doneTimeout);
            }
        }

        // Run scheduler loop every 25ms
        schedulerInterval = setInterval(schedulerTick, 25);
    }

    document.getElementById('play-btn').addEventListener('click', () => {
        playMorseSequence(document.getElementById('text-input').value);
    });
    
    document.getElementById('stop-btn').addEventListener('click', () => {
        stopRequested = true;
        isPlaying = false;
        if (schedulerInterval) clearInterval(schedulerInterval);
        stopAllVoices();
        clearAllTimeouts();
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
        stopRequested = true;
        isPlaying = false;
        if (schedulerInterval) clearInterval(schedulerInterval);
        stopAllVoices();
        clearAllTimeouts();
        document.getElementById('text-input').value = '';
        document.getElementById('morse-visual-display').innerHTML = '';
    });

    document.getElementById('text-input').addEventListener('input', (e) => {
        const newChar = e.data;
        if (!isPlaying && newChar && MORSE_DICT[newChar.toUpperCase()]) {
            playMorseSequence(newChar.toUpperCase());
        }
    });

    // --- Decoder Logic (Mic Audio to Text) with ADAPTIVE TRACKING ---
    let micStream;
    let analyser;
    let decodeAnimationFrame;
    let decodingActive = false;
    
    const startMicBtn = document.getElementById('start-mic-btn');
    const stopMicBtn = document.getElementById('stop-mic-btn');
    const signalLevel = document.getElementById('signal-level');
    
    // UI Elements for decoder
    const estimatedWpmDisplay = document.getElementById('estimated-wpm');
    const rawSymbolsDisplay = document.getElementById('raw-symbols-display');
    const decodedTextDisplay = document.getElementById('decoded-text');

    // Adaptive Tracking Variables
    let isToneCurrentlyOn = false;
    let lastStateChangeTime = 0;
    let currentSymbolBuffer = "";
    let adaptiveDotMs = 60; 
    let wordSpaceAdded = true; 

    async function startDecoding() {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            await initAudio(); 
            
            const micSource = audioContext.createMediaStreamSource(micStream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            micSource.connect(analyser);
            
            decodingActive = true;
            startMicBtn.disabled = true;
            stopMicBtn.disabled = false;
            
            decodedTextDisplay.textContent = "";
            rawSymbolsDisplay.textContent = "";
            currentSymbolBuffer = "";
            wordSpaceAdded = true;
            
            const startWpm = parseFloat(document.getElementById('synth-wpm').value);
            adaptiveDotMs = 1200 / startWpm; 
            estimatedWpmDisplay.textContent = `Estimated Speed: ~${Math.round(startWpm)} WPM (Listening...)`;
            
            lastStateChangeTime = performance.now();
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
        estimatedWpmDisplay.textContent = "Estimated Speed: Stopped.";
    }

    startMicBtn.addEventListener('click', startDecoding);
    stopMicBtn.addEventListener('click', stopDecoding);

    function analyzeIncomingSignal() {
        if (!decodingActive) return;

        const dataArray = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(dataArray);

        let maxEnergy = -100;
        for(let i = 0; i < dataArray.length; i++) {
            if (dataArray[i] > maxEnergy) maxEnergy = dataArray[i];
        }

        const meterPercent = Math.max(0, Math.min(100, (maxEnergy + 100) * 1.5));
        signalLevel.style.width = `${meterPercent}%`;

        const threshold = parseFloat(document.getElementById('mic-threshold').value);
        const toneDetected = maxEnergy > threshold;
        const now = performance.now();
        const duration = now - lastStateChangeTime;

        if (toneDetected !== isToneCurrentlyOn) {
            if (!toneDetected) {
                if (duration > 20) { 
                    let symbolDetected;
                    
                    if (duration < adaptiveDotMs * 1.8) {
                        adaptiveDotMs = (adaptiveDotMs * 0.7) + (duration * 0.3);
                        symbolDetected = ".";
                    } else {
                        adaptiveDotMs = (adaptiveDotMs * 0.7) + ((duration / 3) * 0.3);
                        symbolDetected = "-";
                    }

                    adaptiveDotMs = Math.max(20, Math.min(240, adaptiveDotMs));

                    const currentWpm = Math.round(1200 / adaptiveDotMs);
                    estimatedWpmDisplay.textContent = `Estimated Speed: ~${currentWpm} WPM`;

                    currentSymbolBuffer += symbolDetected;
                    rawSymbolsDisplay.textContent += symbolDetected;
                    rawSymbolsDisplay.scrollTop = rawSymbolsDisplay.scrollHeight;
                }
            } 
            isToneCurrentlyOn = toneDetected;
            lastStateChangeTime = now;
        } else if (!toneDetected && currentSymbolBuffer.length > 0) {
            if (duration > adaptiveDotMs * 2.5) {
                const char = REVERSE_MORSE[currentSymbolBuffer];
                
                if (char) decodedTextDisplay.textContent += char;
                else decodedTextDisplay.textContent += "?";
                
                decodedTextDisplay.scrollTop = decodedTextDisplay.scrollHeight;
                currentSymbolBuffer = "";
                wordSpaceAdded = false;
                rawSymbolsDisplay.textContent += " ";
            }
        } else if (!toneDetected && currentSymbolBuffer.length === 0 && !wordSpaceAdded) {
            if (duration > adaptiveDotMs * 5.5) {
                decodedTextDisplay.textContent += " ";
                rawSymbolsDisplay.textContent += " / "; 
                wordSpaceAdded = true;
            }
        }

        decodeAnimationFrame = requestAnimationFrame(analyzeIncomingSignal);
    }
});
