import { NoshWallet } from '../src/wallet.js';
import fs from 'fs';
const w1 = NoshWallet.loadFromFile('data/wallets/manualA.json');
const w2 = JSON.parse(fs.readFileSync('data/wallets/manualB.json','utf8'));
const balRes = await fetch('http://127.0.0.1:3001/api/address/'+w1.address);
const balJ = await balRes.json();
const bal = BigInt(balJ.data.balance);
if (bal < 1000000000000000n) {
  console.log(new Date().toISOString(), 'balance low, mining');
  await fetch('http://127.0.0.1:3001/api/mine', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({miner: w1.address})});
  process.exit(0);
}
const tx = w1.sign(w1.address, w2.address, '100000000000000000', '1000000000000000', balJ.data.nonce);
const r = await fetch('http://127.0.0.1:3001/api/transactions', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(tx)});
const j = await r.json();
console.log(new Date().toISOString(), 'tx', j.success ? (j.data?.hash?.slice(0,12) || j.hash?.slice(0,12)) : JSON.stringify(j.error));
