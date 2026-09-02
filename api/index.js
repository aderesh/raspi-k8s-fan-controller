var express = require("express");
const fs = require("fs");
const { execFileSync } = require('child_process');

var app = express();
function numberSetting(name, defaultValue, { integer = false, min = -Infinity, exclusiveMin = false } = {}) {
  const rawValue = process.env[name];
  const value = rawValue === undefined ? defaultValue : Number(rawValue);
  const valid = Number.isFinite(value)
    && (!integer || Number.isInteger(value))
    && (exclusiveMin ? value > min : value >= min);

  if (!valid) {
    throw new Error(`Invalid ${name}: ${rawValue}`);
  }
  return value;
}

const port = numberSetting('NODE_PORT', 36637, { integer: true, min: 1 });
const intervalMs = numberSetting('INTERVAL_MS', 1000, { min: 0, exclusiveMin: true });
const expiryMs = numberSetting('EXPIRY_MS', 5000, { min: 0, exclusiveMin: true });
const lowTempC = numberSetting('LOW_TEMP_C', 60);
const highTempC = numberSetting('HIGH_TEMP_C', 78);
const defaultTempC = numberSetting('DEFAULT_TEMP_C', highTempC);
const pwmChipName = process.env.PWM_CHIP || 'pwmchip0';
const pwmChannel = numberSetting('PWM_CHANNEL', 0, { integer: true, min: 0 });
const frequencyHz = numberSetting('FREQUENCY_HZ', 25000, { min: 0, exclusiveMin: true });
const gpioPin = numberSetting('GPIO_PIN', 18, { integer: true, min: 0 });
const fanRpmMin = numberSetting('FAN_RPM_MIN', 0, { min: 0 });
const fanRpmMax = numberSetting('FAN_RPM_MAX', 1000, { min: 0 });

if (highTempC <= lowTempC) {
  throw new Error('HIGH_TEMP_C must be greater than LOW_TEMP_C');
}
if (fanRpmMax < fanRpmMin) {
  throw new Error('FAN_RPM_MAX must be greater than or equal to FAN_RPM_MIN');
}

const periodNs = Math.round(1e9 / frequencyHz);
const pwmChip = `/sys/class/pwm/${pwmChipName}`;
const pwmBase = `${pwmChip}/pwm${pwmChannel}`;

function writeSysfs(path, value) {
  const fileDescriptor = fs.openSync(path, fs.constants.O_WRONLY);
  try {
    fs.writeSync(fileDescriptor, String(value));
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function writeSysfsWhenReady(path, value) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return writeSysfs(path, value);
    } catch (error) {
      if (error.code !== 'EACCES') throw error;
    }
  }
  throw new Error(`Timed out waiting for ${path} to become writable (udev not ready?)`);
}

function readSysfsNumber(path) {
  return Number(fs.readFileSync(path, 'utf8').trim());
}

function enableFanPwmOutput() {
  execFileSync('raspi-gpio', ['set', String(gpioPin), 'a5']);
}

let currentPwm = 0;

function fanStatus() {
  const percent = Math.round(currentPwm / 255 * 100);
  const calculatedRpm = Math.round(fanRpmMin + (fanRpmMax - fanRpmMin) * currentPwm / 255);

  return {
    pwm: currentPwm,
    percent,
    calculated_rpm: calculatedRpm
  };
}

app.get('/fan', (req, res) => {
  res.status(200).json(fanStatus());
});

app.get('/', (req, res) => {
  res.status(200).json({
    fan: fanStatus(),
    config: {
      node_port: port,
      gpio: gpioPin,
      pwm_chip: pwmChipName,
      pwm_channel: pwmChannel,
      frequency_hz: frequencyHz,
      interval_ms: intervalMs,
      expiry_ms: expiryMs,
      low_temp_C: lowTempC,
      high_temp_C: highTempC,
      default_temp_C: defaultTempC,
      fan_rpm_min: fanRpmMin,
      fan_rpm_max: fanRpmMax
    },
    nodes: Object.fromEntries(
      Object.entries(temperatureRecords).map(([node, record]) => [node, {
        temp_C: record.temperatureMilliC / 1000,
        expire: record.expiresAt
      }])
    )
  });
});

function releaseFanPwmOutput() {
  execFileSync('raspi-gpio', ['set', String(gpioPin), 'op']);
  execFileSync('raspi-gpio', ['set', String(gpioPin), 'dh']);
}

function initializePwm() {
  try {
    if (!fs.existsSync(pwmChip)) {
      throw new Error(`PWM chip '${pwmChipName}' not found — check PWM_CHIP value or apply dtoverlay=pwm in /boot/config.txt`);
    }

    if (!fs.existsSync(pwmBase)) {
      fs.writeFileSync(`${pwmChip}/export`, String(pwmChannel));
    }

    const currentPeriod = readSysfsNumber(`${pwmBase}/period`);
    const currentDutyCycle = readSysfsNumber(`${pwmBase}/duty_cycle`);
    const currentEnable = readSysfsNumber(`${pwmBase}/enable`);
    const periodChanged = currentPeriod !== periodNs;

    if (periodChanged) {
      if (currentEnable === 1) writeSysfsWhenReady(`${pwmBase}/enable`, 0);
      if (currentDutyCycle > periodNs) writeSysfsWhenReady(`${pwmBase}/duty_cycle`, 0);
      writeSysfsWhenReady(`${pwmBase}/period`, periodNs);
    }
    writeSysfsWhenReady(`${pwmBase}/duty_cycle`, 0);
    if (currentEnable !== 1 || periodChanged) writeSysfsWhenReady(`${pwmBase}/enable`, 1);

    enableFanPwmOutput();
    console.log(`GPIO${gpioPin} set to ALT5 (PWM)`);
    console.log(`PWM: ${pwmChipName}/pwm${pwmChannel}, Frequency: ${frequencyHz}Hz, Period: ${periodNs}ns`);
  } catch (error) {
    try {
      releaseFanPwmOutput();
    } catch (releaseError) {
      console.error('GPIO release error:', releaseError.message);
    }
    throw error;
  }
}

const temperatureRecords = Object.create(null);

app.get('/node/:node/temp/:temp', (req, res) => {
  const temperatureMilliC = Number(req.params.temp);
  let recordExpiryMs = expiryMs;

  if (!Number.isFinite(temperatureMilliC)) {
    return res.status(400).send('temp must be a finite number of millidegrees Celsius');
  }

  if (req.query.expire_ms !== undefined) {
    recordExpiryMs = Number(req.query.expire_ms);
    if (!Number.isFinite(recordExpiryMs) || recordExpiryMs <= 0) {
      return res.status(400).send('expire_ms must be a positive number of milliseconds');
    }
  }

  const node = req.params.node;
  console.log(`Received update from '${node}': ${temperatureMilliC} mC`);

  temperatureRecords[node] = {
    expiresAt: new Date(Date.now() + recordExpiryMs),
    temperatureMilliC
  };

  res.status(204).end();
});

function hottestTemperature() {
  const now = Date.now();
  let hottestNode = 'N/A';
  let hottestTemperatureMilliC = defaultTempC * 1000;

  for (const node of Object.keys(temperatureRecords)) {
    const record = temperatureRecords[node];
    if (record.expiresAt.getTime() < now) {
      console.debug(`delete ${node}`);
      delete temperatureRecords[node];
    } else if (hottestNode === 'N/A' || record.temperatureMilliC > hottestTemperatureMilliC) {
      hottestNode = node;
      hottestTemperatureMilliC = record.temperatureMilliC;
    }
  }

  return {
    node: hottestNode,
    temperatureC: hottestTemperatureMilliC / 1000
  };
}

function pwmForTemperature(temperatureC) {
  const pwm = (Math.max(lowTempC, temperatureC) - lowTempC) * 255 / (highTempC - lowTempC);
  return Math.ceil(Math.max(Math.min(255, pwm), 0));
}

function setFanPwm(pwm) {
  const dutyCycleNs = Math.min(Math.round(periodNs * pwm / 255), periodNs);
  try {
    writeSysfs(`${pwmBase}/duty_cycle`, dutyCycleNs);
    currentPwm = pwm;
    if (!fanPwmOutputEnabled) {
      enableFanPwmOutput();
      fanPwmOutputEnabled = true;
    }
  } catch (error) {
    console.error('PWM duty_cycle write error:', error.message);
    fanPwmOutputEnabled = false;
    try {
      releaseFanPwmOutput();
    } catch (releaseError) {
      console.error('GPIO release error:', releaseError.message);
    }
  }
}

function updateFan() {
  const { node, temperatureC } = hottestTemperature();
  const pwm = pwmForTemperature(temperatureC);
  console.log(`Fan pwm: ${pwm}. Max: ${node}(${temperatureC}C). Records: ${JSON.stringify(temperatureRecords)}`);
  setFanPwm(pwm);
}

let interval;
let fanPwmOutputEnabled = false;
let pwmInitialized = false;
const server = app.listen(port);

server.on('error', error => {
  console.error('Server error:', error.message);
  if (pwmInitialized) shutdown(1);
  else process.exit(1);
});

server.on('listening', () => {
  try {
    initializePwm();
  } catch (error) {
    console.error('PWM initialization error:', error.message);
    server.close(() => process.exit(1));
    return;
  }

  pwmInitialized = true;
  fanPwmOutputEnabled = true;
  updateFan();
  interval = setInterval(updateFan, intervalMs);
  console.log(`app running on port ${port}`);
});

process.on('SIGHUP', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown(exitCode = 0) {
  console.log('shutdown request, terminating');
  try {
    fs.writeFileSync(`${pwmChip}/unexport`, String(pwmChannel));
  } catch (e) { console.error('PWM unexport error:', e.message); }
  try {
    releaseFanPwmOutput();
    fanPwmOutputEnabled = false;
  } catch (e) { console.error('GPIO release error:', e.message); }
  if (interval) clearInterval(interval);
  process.exit(exitCode);
}
