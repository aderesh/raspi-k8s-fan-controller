# API
## Environment variables
- `INTERVAL_SEC` - frequency the fan PWM is updated. Default: 1 sec.
- `NODE_PORT` - default API port. Default: 80.
- `EXPIRY_SEC` - how long API should consider a node since last update
- `LOW_TEMP_C` - lowest temp in C when fan turns on. Default: 60
- `HIGH_TEMP_C` - temp in C when fan goes 100%. Default: 78
- `DEFAULT_TEMP_C` - default temp in C when no node reported their temp. Default: same as `HIGH_TEMP_C`
- `FREQUENCY_HZ` - PWM's frequency. It seems the max frequency that can be set is 8000Hz. Fans' PWM standard is 25kHz(seems like). Default: 8000Hz(max)

# Development
## Install `Remote - SSH`
Install `Remote - SSH` plugin to connect to raspberry pi and do you development there since `raspi` npm package can be used only with arm architecture
## 'raspi' dependencies
Execute the following before `npm install`
```shell
sudo apt-get install -y libpigpio-dev libpigpio1 libpigpiod-if-dev libpigpiod-if1 libpigpiod-if2-1 pigpio pigpio-tools pigpiod
```

# Schematic
Shematic, explanation - https://raspberrypi.stackexchange.com/a/142380/145426

# Troubleshooting scripts
## Manual script
Pre-reqs: see 'Development'
Recommended to use with LED + 330 OM resistor instead of fan.
Note: frequency is `2500` - it's important. Check the stackexchange explanation (https://raspberrypi.stackexchange.com/a/142380/145426). The pigpio npm library itself seems to work well with 8000. Also, when 2500 is set, pigpio uses 3000 for some reason. 
```python
#!/usr/bin/env python3

import RPi.GPIO as GPIO
import time

GPIO.setwarnings(False)

GPIO.setmode(GPIO.BCM)
GPIO.setup(18, GPIO.OUT)

p = GPIO.PWM(18, 2500)
p.start(0)

time.sleep(1)

try:
    while True:
        p.ChangeDutyCycle(100)
        print('100')
        time.sleep(5)
        p.ChangeDutyCycle(50)
        print('50')
        time.sleep(5)
        p.ChangeDutyCycle(0)
        print('0')
        time.sleep(5)

except KeyboardInterrupt:
    pass

p.ChangeDutyCycle(0)
p.stop()
GPIO.cleanup()
```

## Request
The following request would create a test node `Test` with temperature 90 C which would put fan for 100% duty cycle. 
```
http://192.168.0.50:31111/node/TEST/temp/90000
```
