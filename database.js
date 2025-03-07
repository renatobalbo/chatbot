const sql = require('mssql');
require('dotenv').config();

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

async function getConnection() {
  await poolConnect;
  return pool;
}

module.exports = { getConnection, sql };
