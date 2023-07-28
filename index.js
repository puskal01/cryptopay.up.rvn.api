const express = require('express');
const Ravencoin = require('ravencoinjs-lib');
const fetch = require('node-fetch-polyfill');

const app = express();
const RVN = Ravencoin;
const SAT_IN_RVN = 100000000;
const FEE_TO_SEND_RVN = 0.0001 * SAT_IN_RVN;
const MINER_FEE = 2000;

async function getUtxos(address) {
  const url = `https://api.ravencoin.org/api/addr/${address}/utxo`;
  const response = await fetch(url);
  const resultData = await response.json();
  return resultData;
}

async function getbalance(address) {
  const url = `https://api.ravencoin.org/api/addr/${address}/balance`;
  const response = await fetch(url);
  const resultData = await response.json();
  return parseFloat(resultData);
}

async function createTransaction(privateKey, origin, destination, amount) {
  const keyPair = Ravencoin.ECPair.fromWIF(privateKey);
  let utxos = await getUtxos(origin);
  let transactionAmount = 0;

  if (!utxos || !utxos.length) {
    throw new Error('No UTXOs found for origin address');
  }

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
  scriptPubKey: Ravencoin.script.pubKeyHash.output.encode(Ravencoin.crypto.hash160(keyPair.getPublicKeyBuffer())),
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

const Fetch = require('node-fetch');

async function publishTx(serializedTransaction) {
  try {
    const url = 'https://api.ravencoin.org/tx/send';
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        rawtx: serializedTransaction
      })
    };
    const response = await Fetch(url, options);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to publish transaction');
  }
}
async function sendTransaction(address, my_address, privateKey, amount) {
  try {
    const balance = await getbalance(my_address);
    if (balance === 0) {
      throw new Error('Insufficient balance');
    }

    if (amount === 0) {
      throw new Error('Invalid amount');
    }

    const serializedTransaction = await createTransaction(privateKey, my_address, address, amount);
    if (!serializedTransaction) {
      throw new Error('Failed to create transaction');
    }

    console.log(serializedTransaction); // Add this line

    const fee = MINER_FEE / SAT_IN_RVN;
    const transactionAmount = parseFloat(amount) * SAT_IN_RVN;
    const totalAmount = transactionAmount + FEE_TO_SEND_RVN + fee;
    const remainingBalance = balance - totalAmount;

    const transactionResult = await publishTx(serializedTransaction);
    if (!transactionResult || !transactionResult.txid) {
      throw new Error('Failed to publish transaction');
    }

    return {
      txid: transactionResult.txid,
      withdrawnAmount: amount,
      toaddr: address,
      fromAddress: my_address,
      remainingBalance: remainingBalance,
      fee: fee,
    };
  } catch (error) {
    console.error(error);
    throw new Error('Error sending transaction');
  }
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
    console.error(error);
    res.status(500).json({ error: 'Failed to deposit RVN' });
  }
});

app.get('/sendrvn/:privateKey/:address/:my_address/:amount', async (req, res) => {
  try {
    const { privateKey, address, amount, my_address } = req.params;
    const result = await sendTransaction(address, my_address, privateKey, amount);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send RVN' });
  }
});

const port = 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
