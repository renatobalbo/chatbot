const sql = require('mssql');
const pdfkit = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { simpleGit } = require('simple-git');
const git = simpleGit();
const { getConnection } = require('./database');
const { generateXmlReport } = require('./reportXml');
const { generatePdfReport } = require('./reportPdf');

const userState = {}; // Controle de estado por usuário

// Classe de Hospedagem de Arquivos
class FileHostingService {
  constructor(repoPath, branchName = 'reports') {
    this.repoPath = repoPath;
    this.branchName = branchName;
  }

  async initializeRepository() {
    try {
      if (!fs.existsSync(this.repoPath)) {
        fs.mkdirSync(this.repoPath, { recursive: true });
      }
  
      await git.init(this.repoPath);
  
      // Tenta remover o remote origin existente
      try {
        await git.removeRemote('origin');
      } catch (removeError) {
        console.log('Nenhum remote origin existente para remover');
      }
  
      // Adiciona novo remote
      await git.addRemote('origin', 'https://github.com/renatobalbo/chatbot.git');
      
      // Verifica se a branch já existe
      try {
        await git.checkout(this.branchName);
      } catch (checkoutError) {
        // Se não existir, cria a branch
        await git.checkout(['-b', this.branchName]);
      }
    } catch (error) {
      console.error('Erro ao inicializar repositório:', error);
      throw error;
    }
  }

  async hostFile(filePath, fileName) {
    try {
      const destinationPath = path.join(this.repoPath, fileName);
      fs.copyFileSync(filePath, destinationPath);

      await git
        .add(destinationPath)
        .commit(`Adicionar relatório: ${fileName}`)
        .push('origin', this.branchName);

      // URL pública do GitHub Pages
      return `https://renatobalbo.github.io/chatbot/${fileName}`;
    } catch (error) {
      console.error('Erro ao hospedar arquivo:', error);
      return null;
    }
  }

  async cleanupOldFiles(maxFiles = 10) {
    try {
      const files = fs.readdirSync(this.repoPath)
        .filter(file => file.startsWith('Extrato_'));

      if (files.length > maxFiles) {
        const oldestFiles = files
          .sort((a, b) => fs.statSync(path.join(this.repoPath, a)).mtime - 
                          fs.statSync(path.join(this.repoPath, b)).mtime)
          .slice(0, files.length - maxFiles);

        oldestFiles.forEach(file => {
          fs.unlinkSync(path.join(this.repoPath, file));
          git.rm(file);
        });
      }
    } catch (error) {
      console.error('Erro na limpeza de arquivos:', error);
    }
  }
}

// Funções auxiliares existentes (mantidas do código original)
function isValidDate(dateStr) {
  const date = dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/);
  if (!date) return false;
  const [day, month, year] = dateStr.split('/').map(Number);
  const parsedDate = new Date(year, month - 1, day);
  return parsedDate.getDate() === day && parsedDate.getMonth() === month - 1 && parsedDate.getFullYear() === year;
}

function convertToISO(dateStr) {
  const [day, month, year] = dateStr.split('/');
  return `${year}-${month}-${day}`;
}

function buildReportFileName(user, format) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
  return `Extrato_${user}_${date}_${time}.${format}`;
}

async function getUserResponse(client, user, question) {
  if (question) await client.sendMessage(user, question);
  return new Promise(resolve => {
    const messageHandler = response => {
      if (response.from === user) {
        client.removeListener('message', messageHandler);
        resolve(response);
      }
    };
    client.once('message', messageHandler);
  });
}

async function generateStatementReport(client, msg, format) {
  const fileHosting = new FileHostingService('./github-reports');
  
  try {
    // Inicializa repositório de hospedagem
    await fileHosting.initializeRepository();

    const user = msg.from;
    if (!userState[user]) userState[user] = { etapa: 'carteira', carteira: null, periodo: null };

    if (userState[user].etapa === 'carteira' && !userState[user].carteira) {
      const pool = await getConnection();
      const carteirasResult = await pool.request()
        .input('usuario', sql.VarChar, user)
        .query(`
          SELECT Codigo, Descricao, ID
          FROM Carteiras
          WHERE Usuario = @usuario
          UNION ALL
          SELECT '1', 'Geral', NULL
          ORDER BY Codigo
        `);

      const carteiras = carteirasResult.recordset;
      if (carteiras.length === 0) {
        await client.sendMessage(user, 'Você não tem carteiras cadastradas. Cadastre uma antes de gerar o extrato.');
        delete userState[user];
        return;
      }

      if (carteiras.length === 1) {
        userState[user].carteira = carteiras[0].Codigo;
        userState[user].etapa = 'periodo';
      } else if (!userState[user].carteira) {
        let carteirasMsg = 'Escolha uma carteira:\n';
        carteiras.forEach(c => {
          carteirasMsg += `${c.Codigo} - ${c.Descricao}\n`;
        });

        const carteiraMsg = await getUserResponse(client, user, carteirasMsg);
        userState[user].carteira = carteiraMsg.body;
        userState[user].etapa = 'periodo';
      }
    }

    if (userState[user].etapa === 'periodo' && !userState[user].periodo) {
      const periodoMsg = await getUserResponse(client, user, 'Informe o período desejado (formato: DD/MM/YYYY a DD/MM/YYYY):');
      const periodo = periodoMsg.body.split(' a ');

      if (periodo.length !== 2) {
        await client.sendMessage(user, 'Formato de período inválido. Por favor, use o formato DD/MM/YYYY a DD/MM/YYYY.');
        return;
      }

      const [dataInicio, dataFim] = periodo;

      if (!isValidDate(dataInicio) || !isValidDate(dataFim)) {
        await client.sendMessage(user, 'Formato de data inválido. Por favor, use o formato DD/MM/YYYY a DD/MM/YYYY.');
        return;
      }

      userState[user].periodo = { dataInicio, dataFim };
      userState[user].etapa = 'finalizado';
    }

    if (userState[user].etapa === 'finalizado') {
      const { carteira, periodo } = userState[user];
      const dataInicioISO = convertToISO(periodo.dataInicio);
      const dataFimISO = convertToISO(periodo.dataFim);

      const pool = await getConnection();

      let carteiraId = null;
      if (carteira !== '1') {
        const carteiraResult = await pool.request()
          .input('usuario', sql.VarChar, user)
          .input('codigo', sql.VarChar, carteira)
          .query(`SELECT ID FROM Carteiras WHERE Usuario = @usuario AND Codigo = @codigo`);

        carteiraId = carteiraResult.recordset[0]?.ID;
      }

      const result = await pool.request()
        .input('usuario', sql.VarChar, user)
        .input('carteiraId', sql.Int, carteiraId)
        .input('dataInicio', sql.Date, dataInicioISO)
        .input('dataFim', sql.Date, dataFimISO)
        .query(`
          SELECT CONVERT(varchar, Data, 103) AS Data, Valor, Tipo, Movimentacoes.Categoria,
                 CONCAT(Movimentacoes.Categoria, '-', Categorias.Descricao) AS CategoriaDescricao
          FROM Movimentacoes
          LEFT JOIN Categorias
          ON Movimentacoes.Categoria = Categorias.Codigo
          WHERE Movimentacoes.Usuario = @usuario
          ${carteiraId !== null ? 'AND Carteira = @carteiraId' : ''}
          AND Data BETWEEN @dataInicio AND @dataFim
        `);

      const movimentacoes = result.recordset;

      const reportsDir = path.join(__dirname, 'github-reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir);
      }

      const fileName = buildReportFileName(user, format);
      const filePath = path.join(reportsDir, fileName);

      if (format === 'pdf') {
        await generatePdfReport(movimentacoes, carteira, periodo, filePath);
      } else if (format === 'xml') {
        await generateXmlReport(movimentacoes, carteira, periodo, filePath);
      }

      // Hospedar arquivo no GitHub
      const publicUrl = await fileHosting.hostFile(filePath, fileName);

      // Enviar mensagem com URL do arquivo
      if (publicUrl) {
        await client.sendMessage(user, {
          document: { 
            url: publicUrl, 
            filename: fileName 
          },
          caption: 'Seu relatório está pronto!'
        });
      } else {
        await client.sendMessage(user, 'Erro ao gerar URL do relatório.');
      }

      // Limpar arquivos antigos
      await fileHosting.cleanupOldFiles();

      delete userState[user];
    }
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    await client.sendMessage(msg.from, 'Ocorreu um erro ao gerar o relatório. Por favor, tente novamente.');
    delete userState[msg.from];
  }
}

module.exports = { generateStatementReport };