# STM32F746G-DISCO Home Hub

This project is a simple LED blink example for the STM32F746G-DISCO board using the Arduino framework.

## Hardware Requirements

- STM32F746G-DISCO board
- USB cable (for connecting to ST-Link)

## Software Requirements

- PlatformIO
- ST-Link drivers (for macOS/Windows/Linux)

## Setup

1. Connect the STM32F746G-DISCO board to your computer via the ST-Link USB port.
2. Make sure the ST-Link drivers are installed.
3. Open the project in PlatformIO.
4. Build and upload the firmware:
   ```
   pio run --target upload
   ```
5. To monitor the serial output:
   ```
   pio device monitor
   ```

## Project Structure

- `src/main.cpp`: The main application code (Arduino sketch)
- `platformio.ini`: PlatformIO configuration file

## Current Functionality

The firmware implements a simple LED blink application that:
- Blinks the user LED (green, PI1) at a 1Hz rate (500ms on, 500ms off)
- Outputs status messages via the serial port (115200 baud)

## Serial Communication

The board communicates via UART at 115200 baud. It outputs the following information:
- Startup banner with board and framework information
- LED state changes (ON/OFF)

## Troubleshooting

If you experience upload issues:
1. Make sure the board is connected via the ST-Link USB port
2. Verify that you have the ST-Link drivers installed
3. Try using the verbose flag: `pio run --target upload -v`
4. Check that the board is not in a bootloader mode or reset it before uploading

## Further Development

Potential enhancements for this project include:
- Adding sensors (temperature, humidity, etc.)
- Implementing WiFi connectivity
- Creating a home automation control center
- Adding a touchscreen interface using the board's built-in display 