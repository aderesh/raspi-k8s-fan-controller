# API

## v1 → v2
v1 used the `pigpio` npm package (DMA-based software PWM). It required native build tools (`python3`, `make`, `g++`), system libraries, and a running `pigpiod` daemon. pigpio has had no active development for years and its DMA PWM was found to be silently broken on CM4 — the GPIO. 

v2 replaces pigpio with direct sysfs hardware PWM (`/sys/class/pwm`), using Node's built-in `fs` module. It has no native npm dependencies or daemon, and uses the kernel's hardware PWM driver.

## Requirements
- Raspberry Pi OS or another Linux system with `/sys/class/pwm` and the `raspi-gpio` utility available on `PATH`.
- The account running the controller must be able to write the selected PWM sysfs files and run `raspi-gpio`.
- A 4-pin fan PWM control wire connected to GPIO18. GPIO12 enables PWM0 but is intentionally not connected to the fan.

Install and run on the Raspberry Pi:
```shell
cd api
npm install
npm start
```

For production, run `node index.js` under a process supervisor rather than `nodemon`.

## Environment variables
- `INTERVAL_MS` - frequency the fan PWM is updated, in milliseconds. Default: `1000`.
- `NODE_PORT` - API port. Default: `36637`.
- `EXPIRY_MS` - how long the API considers a node current after its last update, in milliseconds. Default: `5000`.
- `LOW_TEMP_C` - temperature in Celsius where the fan begins increasing from 0%. Default: `60`.
- `HIGH_TEMP_C` - temperature in Celsius where the fan reaches 100%. Must be greater than `LOW_TEMP_C`. Default: `78`.
- `DEFAULT_TEMP_C` - temperature in Celsius used when no node has a current report. Default: `HIGH_TEMP_C`.
- `FREQUENCY_HZ` - PWM frequency in Hz. Default: `25000` (4-pin fan standard).
- `PWM_CHIP` - sysfs PWM chip name. Default: `pwmchip0` (see [Hardware Setup](#hardware-setup))
- `PWM_CHANNEL` - sysfs PWM channel number. Default: `0` (see [Hardware Setup](#hardware-setup))
- `GPIO_PIN` - GPIO the application switches to ALT5 for PWM output. Default: `18`; this setup uses GPIO18 for PWM0 channel 0.

# Hardware Setup
Add the following to `/boot/config.txt`:
```ini
dtoverlay=pwm,pin=12,func=4
gpio=18=op,dh
```
Then reboot. Verify the PWM channel and application pin with:
```shell
ls /sys/class/pwm/          # chip name, e.g. pwmchip0  → PWM_CHIP=pwmchip0
raspi-gpio get 18           # e.g. func=PWM0_0
#                                        ^^^^^ → PWM0 = chip 0, _0 = channel 0 → PWM_CHANNEL=0
```

## Why the overlay uses GPIO12
`dtoverlay=pwm,pin=12,func=4` enables the PWM0 hardware channel and initially routes it to GPIO12. GPIO12 is intentionally not connected to the fan. The application configures the same PWM0 channel through sysfs, then switches GPIO18 to ALT5 so GPIO18 carries that PWM signal.

Keeping GPIO18 out of the overlay lets `gpio=18=op,dh` hold the fan-control pin HIGH during boot, before the app starts, and after a normal shutdown. A 4-pin fan interprets constant HIGH as full speed, which is the chosen fail-safe state. The app switches GPIO18 to PWM ALT5 only while it is controlling the fan, and returns it to output HIGH during graceful shutdown.

This cannot protect against `SIGKILL`, kernel panic, or abrupt power loss while the app owns GPIO18: those conditions do not run the shutdown handler, so the pin can remain in its last PWM state until the device reboots or a supervisor restarts the app. Use a process supervisor for restart recovery; hardware-only fail-safe behavior requires additional external circuitry.

If a runtime `duty_cycle` write fails, the controller releases GPIO18 to output HIGH immediately. It retries PWM control on later update cycles; a successful write switches GPIO18 back to ALT5.

## Container Deployment
The `api/Dockerfile` uses the pinned Node 24 LTS `bookworm-slim` image. This glibc-based Debian image is small while remaining compatible with the Raspberry Pi `raspi-gpio` package, which the image installs during its build.

Build from the repository root for the Raspberry Pi's `linux/arm64` architecture:
```shell
docker build --platform linux/arm64 -f api/Dockerfile -t rpi-fan-controller .
```

The publishing workflow builds `linux/arm64` images only because the controller requires Raspberry Pi-specific `raspi-gpio`. The container still needs deliberate hardware access at runtime: mount the host PWM sysfs files and GPIO memory device, and run it with the permissions required by `raspi-gpio`. For Kubernetes, use equivalent privileged security settings and `hostPath` mounts. Do not run more than one controller against the same PWM channel and GPIO pin.

### K3s
[`k8s/fan-controller.yaml`](k8s/fan-controller.yaml) deploys the test image `ghcr.io/aderesh/raspi-k8s-fan-controller:latest` on an ARM64 node. It mounts host `/sys` so PWM sysfs links resolve to the host device hierarchy and mounts `/dev/gpiomem` for `raspi-gpio`. The pod is privileged because direct GPIO access requires it. Schedule it only to a node wired and configured for this fan.

The Deployment uses `Recreate` updates so Kubernetes terminates the old controller before it starts a replacement; two controllers must not control the same PWM channel. It exposes the API inside the cluster at `fan-controller.fan-controller.svc.cluster.local:36637`.

Apply it with an account permitted to read the K3s kubeconfig:
```shell
kubectl apply -f k8s/fan-controller.yaml
kubectl -n fan-controller rollout status deployment/fan-controller
```

## Publishing Images And Releases
GitHub Container Registry (GHCR) hosts images for this repository at `ghcr.io/aderesh/raspi-k8s-fan-controller`. The **Publish Container Image** workflow is manual. In GitHub Actions, select the branch to test and run it with `create_release` unchecked. It publishes:

- `<branch>`: the latest image built from that branch.
- `<package-version>-<branch>-<short-sha>`: an immutable image for that exact branch commit.

After testing, select `main` and run the workflow with `create_release` checked. It reads `api/package.json`, publishes `<package-version>` and `latest`, and creates the GitHub Release tag `v<package-version>`.

A GitHub Release is a named, immutable project milestone attached to a Git tag. It provides release notes and downloadable source archives; it is separate from a container image. The branch test workflow deliberately does not create releases because a release version such as `v2.0.0` can exist only once. Bump `api/package.json` before each main release.

# sysfs PWM notes

## Write rules
- `period` must be written before `duty_cycle` or `enable` — all writes fail with `EINVAL` when `period=0` (state after device restart)
  - ✓ `echo 40000 > period` → `echo 20000 > duty_cycle`
  - ✗ `echo <any> > duty_cycle` when `period=0` → EINVAL
  - ✗ `echo <any> > enable` when `period=0` → EINVAL

- `duty_cycle ≤ period` must hold at all times — violating it from either side (setting `duty_cycle` or `period` first) returns `EINVAL`
  - ✓ `period=40000`, `echo 20000 > duty_cycle`
  - ✗ `period=40000`, `echo 50000 > duty_cycle` → EINVAL
  - ✗ `duty_cycle=40000`, `echo 10000 > period` → EINVAL

- `period` cannot be changed while `enable=1` — disable first
  - ✓ `echo 0 > enable` → `echo 10000 > period`
  - ✗ `echo 10000 > period` while `enable=1` → EINVAL

## udev race after export
After writing to `export`, the kernel creates `pwm0/` synchronously but owned by `root:root`. udev asynchronously chowns to `root:gpio` a few milliseconds later. Writes by `pi` fail with `EACCES` during this window. The app retries on `EACCES` until udev completes.

## Cold boot vs `unexport`/`export`
On device restart, hardware registers reset to `period=0` and `duty_cycle=0`. On `unexport` followed by `export`, the hardware registers retain their previous values — `period` is already set and the udev race is the only concern.

# API
Send a node temperature in millidegrees Celsius:
```shell
curl -i http://localhost:36637/node/TEST/temp/79000
```

The endpoint returns `204 No Content` on success. Temperatures must be finite numbers. A report expires after `EXPIRY_MS`, or after the positive millisecond duration passed as `expire_ms`:
```shell
curl -i 'http://localhost:36637/node/TEST/temp/79000?expire_ms=10000'
```

Invalid `temp` or `expire_ms` values return `400 Bad Request`.

# Schematic
Schematic, explanation - https://raspberrypi.stackexchange.com/a/142380/145426

# Troubleshooting scripts
## Manual sysfs PWM test
Stop the controller before this test. Use an LED with a 330-ohm resistor to verify the signal before connecting the fan.
```shell
cd /sys/class/pwm/pwmchip0

# Export channel and configure 25kHz
echo 0 > /sys/class/pwm/pwmchip0/export
echo 40000 > /sys/class/pwm/pwmchip0/pwm0/period
echo 0 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle
echo 1 > /sys/class/pwm/pwmchip0/pwm0/enable

# Test 0%, 50%, 100%
echo 0 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle      # off
echo 20000 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle  # 50%
echo 40000 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle  # 100%

# Cleanup
echo 0 > /sys/class/pwm/pwmchip0/pwm0/enable
echo 0 > /sys/class/pwm/pwmchip0/unexport
raspi-gpio set 18 op dh  # restore fan-control pin to full-speed fail-safe state
```

