const key = 'b6a9bb0bed6f48919daded4e7b1cdef7';
const symbols = ['XAU/USD', 'XAG/USD', 'XPT/USD', 'XPD/USD', 'WTI/USD', 'BRENT/USD', 'NATGAS/USD'];
Promise.all(symbols.map(s => 
  fetch(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(s)}&interval=1h&outputsize=1&apikey=${key}`)
    .then(r => r.json())
    .then(j => console.log(s, j.status, j.message))
));
