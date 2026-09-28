import serial
import time
import csv
import os
from datetime import datetime

# ==========================================
# IMPORTANT: Update this to match your Arduino's port!
# Windows example: 'COM3' or 'COM4'
# Mac/Linux example: '/dev/tty.usbmodem14101'
# ==========================================
SERIAL_PORT = 'COM4' 
BAUD_RATE = 115200
OUTPUT_FILE = 'arduino_telemetry.csv'

def run_bridge():
    print(f"Connecting to Arduino on {SERIAL_PORT}...")
    try:
        # Establish connection to the Arduino
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)  # Wait for the connection to settle
    except Exception as e:
        print(f"\n❌ Error connecting: {e}")
        print("-> Make sure you typed the correct COM port.")
        print("-> Make sure the Serial Monitor in the Arduino IDE is CLOSED (only one program can use the port at a time).")
        return

    print(f"✅ Connected! Logging data to {OUTPUT_FILE}")
    print("Press Ctrl+C to stop listening.\n")
    
    # Open CSV file for continuous logging
    with open(OUTPUT_FILE, mode='a', newline='') as f:
        writer = csv.writer(f)
        
        # Write header if the file is brand new
        if os.stat(OUTPUT_FILE).st_size == 0:
            writer.writerow(['timestamp', 'z_acceleration', 'jerk', 'anomaly_detected'])

        try:
            while True:
                if ser.in_waiting > 0:
                    # Read the line from Arduino
                    line = ser.readline().decode('utf-8', errors='ignore').strip()
                    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                    
                    if "ANOMALY" in line:
                        print(f"[{now}] 🚨 EDGE ALERT: Rod Float / Impact Detected!")
                        writer.writerow([now, "", "", "TRUE"])
                        f.flush()  # Force write to disk instantly
                        
                        # =========================================================
                        # INTEGRATION POINT WITH USHNA PHYSICS (Section 6.4 Safety Envelope)
                        # When the Arduino detects an anomaly, the Digital Twin should 
                        # clamp/veto the pump speed to prevent rod buckling.
                        # =========================================================
                        print("   -> Action: Triggering Safety Envelope to reduce SPM (Strokes Per Minute).")
                        
                    elif "Z_Acceleration:" in line:
                        try:
                            # Example line: Z_Acceleration:0.98,Jerk:0.02
                            parts = line.split(',')
                            z_accel = parts[0].split(':')[1]
                            jerk = parts[1].split(':')[1]
                            
                            writer.writerow([now, z_accel, jerk, "FALSE"])
                        except IndexError:
                            pass # Skip malformed lines
                        
        except KeyboardInterrupt:
            print("\nStopping telemetry bridge...")
        finally:
            ser.close()
            print("Connection closed.")

if __name__ == '__main__':
    run_bridge()
