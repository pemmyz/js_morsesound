# js_morsesound


# Super Deluxe Morse Machine

A browser-based Morse code encoder and decoder built with vanilla HTML,
CSS, and JavaScript.

## Play it now: https://pemmyz.github.io/js_morsesound/

## Features

-   **Text → Morse transmitter**
    -   Live typing support
    -   Play, Stop, Clear, Loop
    -   Visual Morse output
-   **Microphone → Text receiver**
    -   Adaptive WPM estimation
    -   Raw pulse display
    -   Decoded text output
    -   Adjustable microphone threshold
-   **Audio synthesis**
    -   Sine, Square, Sawtooth, Triangle
    -   PWM, FM, AM, and Ring modulation
    -   Adjustable frequency, volume, and WPM
-   Dark/light mode
-   Fullscreen responsive mode
-   Mobile-friendly scaling

## Files

``` text
index.html    Main application
style.css     Styling and responsive layout
script.js     Morse logic, audio engine, encoder and decoder
```

## Requirements

A modern browser with:

-   Web Audio API
-   MediaDevices API (microphone)
-   Fullscreen API

## Usage

1.  Open `index.html` in a browser.
2.  Click anywhere once to initialize audio.
3.  Use the **Transmitter** to convert text into Morse code.
4.  Use **Receiver** to decode Morse from your microphone.
5.  Adjust waveform, frequency, volume, WPM, and threshold as desired.

## Morse Support

Supports:

-   Letters A--Z
-   Numbers 0--9
-   Spaces

## Technologies

-   HTML5
-   CSS3
-   JavaScript (ES6)
-   Web Audio API
-   Fullscreen API
-   MediaDevices API

## License

MIT License

