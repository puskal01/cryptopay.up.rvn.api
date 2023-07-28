const express = require('express');
const Ravencoin = require('ravencoinjs-lib');
const fetch = require('node-fetch-polyfill');
const app = express();
const RVN = Ravencoin
const SAT_IN_RVN = 100000000;
const FEE_TO_SEND_RVN = 0.0000553 * SAT_IN_RVN;
const MINER_FEE = 2000;



async function getUtxos(address) {
  const url = `https://ravencoin.network/api/addr/${address}/utxo`;
  const response = await fetch(url);
  const resultData = await response.json();
  return resultData;
}

async function getbalance(address) {
  const url = `https://ravencoin.network/api/addr/${address}/balance`;
  const response = await fetch(url);
  const resultData = await response.text(); 
  return parseFloat(resultData) - MINER_FEE; 
}

async function createTransaction(privateKey, origin, destination, amount) {
  const keyPair = Ravencoin.ECPair.fromWIF(privateKey);
  let utxos = await getUtxos(origin);
  let transactionAmount = 0;

  if (!amount) {
    utxos.forEach((utxo) => {
      transactionAmount += parseFloat(utxo.amount) / SAT_IN_RVN;
    });
  } else {
    transactionAmount = parseFloat(amount);
  }

  utxos = utxos.map((utxo) => ({
    txId: utxo.txid,
    vout: +utxo.vout,
    address: origin,
    scriptPubKey: Ravencoin.script.pubKeyHash.output.encode(Ravencoin.crypto.hash160(keyPair.publicKey)),
    amount: parseFloat(utxo.amount) / SAT_IN_RVN,
  }));

  if (!transactionAmount) {
    throw new Error('Not enough balance');
  }

  transactionAmount = transactionAmount.toFixed(8);
  transactionAmount = +transactionAmount * SAT_IN_RVN;

  // if there's no manual amount we're passing all utxos, so we subtract the fee ourselves
  if (!amount) {
    transactionAmount -= FEE_TO_SEND_RVN;
  }

  const txb = new Ravencoin.TransactionBuilder();
  txb.setVersion(1);

  utxos.forEach((utxo) => {
    txb.addInput(utxo.txId, utxo.vout);
  });

  txb.addOutput(destination, transactionAmount);
  txb.addOutput(origin, 0); // Change output

  utxos.forEach((utxo, index) => {
    txb.sign(index, keyPair);
  });

  return txb.build().toHex();
}

async function publishTx(serializedTransaction) {
  const url = `https://ravencoin.network/api/tx/send`;
  const data = JSON.stringify({ rawtx: serializedTransaction });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: data,
  });
  const resultData = await response.json();
  return resultData;
}

async function sendTransaction(address, my_address, privateKey, amount) {
  const serializedTransaction = await createTransaction(privateKey, my_address, address, amount);
  const fee = MINER_FEE / SAT_IN_RVN;
  const remainingBalance = await getbalance(my_address);
  const withdrawnAmount = amount;
  const fromAddress = my_address;

  const transactionResult = await publishTx(serializedTransaction);

  return {
    txid: transactionResult.txid,
    withdrawnAmount: withdrawnAmount,
    toaddr: address,
    fromAddress: fromAddress,
    remainingBalance: remainingBalance,
    fee: fee,
  };
}


app.get('/', (req, res) => {
  // Generate a new RVN address and private key
  const keyPair = RVN.ECPair.makeRandom();
  const address = keyPair.getAddress().toString();
  const privateKey = keyPair.toWIF();


  // Log the address and private key to the console
  console.log(`RVN address: ${address}`);
  console.log(`RVN Private key: ${privateKey}`);

  // Return the address and private key as a JSON object
  res.json({ address, privateKey });
});


app.get('/depositrvn/:privateKey/:address', async (req, res) => {
  try {
    const { privateKey, address } = req.params;
    const my_address = Ravencoin.payments.p2pkh({ pubkey: Ravencoin.ECPair.fromWIF(privateKey).publicKey }).address;
    const balance = await getbalance(my_address);
    const transactionAmount = parseFloat(balance);
    const deposrvn = transactionAmount - 0.00002;
    const result = await sendTransaction(address, my_address, privateKey, deposrvn.toFixed(8));
    res.json(result);
  } catch (error) {
    res.json({ error: error?.message });
  }
});

app.get('/sendrvn/:privateKey/:address/:my_address/:amount', async (req, res) => {
  try {
    const { privateKey, address, amount, my_address } = req.params;
    const result = await sendTransaction(address, my_address, privateKey, amount);
    res.json(result);
  } catch (error) {
    res.json({ error: error?.message });
  }
});


const port = 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
