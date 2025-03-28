#include <Arduino.h>

// LED pin for STM32F746G-DISCO board
// PI1 is the user LED (green)
#define LED_PIN PI1

// Blink patterns for indicating status
// Short blink: Serial via ST-Link is working
// Long blink: Using alternative UART (Serial1)
// Double blink: No serial communication
bool useAltSerial = false;
bool serialConnected = false;

void setup() {
  // Initialize the LED pin as an output
  pinMode(LED_PIN, OUTPUT);
  
  // Try primary Serial via ST-Link
  Serial.begin(115200);
  delay(100); // Short delay to initialize
  
  // Check if Serial is connected
  if (Serial) {
    serialConnected = true;
    Serial.println("\n\n");
    Serial.println("STM32F746G-DISCO LED Blink Example");
    Serial.println("----------------------------------");
    Serial.println("Board: STM32F746G-DISCO");
    Serial.println("Framework: Arduino");
    Serial.println("LED on pin: PI1 (Green LED)");
    Serial.println("----------------------------------");
    Serial.println("Program starting...");
  } else {
    // Try alternate UART (USART1 - PA9/PA10)
    // Note: This requires external hardware (USB-UART adapter)
    // If you want to use this, connect a USB-UART adapter to:
    // - PA9 (TX) -> RX on adapter
    // - PA10 (RX) -> TX on adapter
    // - GND -> GND on adapter
    Serial1.begin(115200);
    delay(100);
    
    if (Serial1) {
      useAltSerial = true;
      serialConnected = true;
      Serial1.println("\n\n");
      Serial1.println("STM32F746G-DISCO LED Blink Example (Alt UART)");
      Serial1.println("---------------------------------------------");
      Serial1.println("Board: STM32F746G-DISCO");
      Serial1.println("Framework: Arduino");
      Serial1.println("LED on pin: PI1 (Green LED)");
      Serial1.println("---------------------------------------------");
      Serial1.println("Program starting...");
    }
  }
}

void loop() {
  
    // No serial connection - use double blink pattern
    digitalWrite(LED_PIN, HIGH);
    delay(50);
    digitalWrite(LED_PIN, LOW);
    delay(50);

   
  
}