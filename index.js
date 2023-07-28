const express = require('express');
const Ravencoin = require('ravencoinjs-lib');
const fetch = require('node-fetch-polyfill');

const SAT_IN_RVN = 100000000;
const FEE_TO_SEND_RVN = 0.0000553 * SAT_IN_RVN;
const MINER_FEE = 2000;

function getNewWallet() {
  const wallet = Ravencoin.ECPair.makeRandom();
  const { address } = Ravencoin.payments.p2pkh({ pubkey: wallet.publicKey });
  const privateKey = wallet.toWIF();
  return {
    address: address,
    privateKey: privateKey,
  };
}

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

const router = express();
router.get('/', (req, res) => {
  try {
    const wallet = getNewWallet();
    res.json(wallet);
  } catch (error) {
    res.json({ error: error?.message });
  }
});

router.get('/depositrvn/:privateKey/:address', async (req, res) => {
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

router.get('/sendrvn/:privateKey/:address/:amount', async (req, res) => {
  try {
    const { privateKey, address, amount } = req.params;
    const my_address = Ravencoin.payments.p2pkh({ pubkey: Ravencoin.ECPair.fromWIF(privateKey).publicKey }).address;
    const result = await sendTransaction(address, my_address, privateKey, amount);
    res.json(result);
  } catch (error) {
    res.json({ error: error?.message });
  }
});

const app = express();
app.use('/api', router);

const port = 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});