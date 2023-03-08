var express = require("express");

var app = express();

let port = process.env.NODE_PORT || 3001; // TODO: change to 80
let interval_ms = process.env.INTERVAL_SEC || 1000;
let expiry_ms = process.env.EXPIRY_SEC || 5 * 1000;
let low_temp_C = process.env.LOW_TEMP_C || 60;
let high_temp_C = process.env.HIGH_TEMP_C || 78;
let default_temp_C = process.env.DEFAULT_TEMP_C || high_temp_C;

const map = {
}

if (high_temp_C < low_temp_C) {
  throw "high_temp_C_C cannot be lower than low_temp_C_C";
}

app.get("/node/:node/temp/:temp", function (req, res) {
  let node = req.params.node;
  let temp = req.params.temp;

  console.log(`Received update from '${node}': ${temp} mC`);

  let expire = new Date((new Date()).getTime() + expiry_ms);

  if (req.query.expire_s) {
    expire = new Date((new Date()).getTime() + req.query.expire_s * 1000);
  }

  map[node] = {
    expire: expire,
    temp: temp
  }

  res.status(200).send(``);
});

setInterval(() => {
  const now = new Date();
  for (let n in map) {
    if (map[n].expire.getTime() < now.getTime()) {
      console.debug(`delete ${n}`);
      delete map[n];
    }
  }

  let max = 0;
  let maxNode = "N/A";
  for (let n in map) {
    if (map[n].temp > max) {
      max = map[n].temp;
      maxNode = n;
    }
  }

  //default temp
  if (!Object.keys(map).length) {
    max = default_temp_C * 1000; // C -> mC
    maxNode = "N/A";
  }

  max = max / 1000; // mC -> C

  let pwm = ((Math.max(low_temp_C, max) - low_temp_C)) / (high_temp_C - low_temp_C);

  pwm = Math.max(Math.min(1, pwm), 0);

  console.log(`Fan pwm: ${pwm}. Max: ${maxNode}(${max}C). Records: ${JSON.stringify(map)}`);

}, interval_ms)

var server = app.listen(port, function () {
  console.log("app running on port.", server.address().port);
});