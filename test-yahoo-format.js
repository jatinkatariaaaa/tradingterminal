fetch(`https://query1.finance.yahoo.com/v8/finance/chart/SI=F?interval=1h&range=5d`)
  .then(r => r.json())
  .then(j => console.log(JSON.stringify(j.chart.result[0].indicators.quote[0].open.slice(0, 2))));
