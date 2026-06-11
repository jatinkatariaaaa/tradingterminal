const symbols = ['GC=F', 'SI=F', 'CL=F', 'EURUSD=X'];
Promise.all(symbols.map(s => 
  fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1h&range=5d`)
    .then(r => r.json())
    .then(j => console.log(s, j.chart?.result?.[0]?.meta?.symbol || j.chart?.error))
));
