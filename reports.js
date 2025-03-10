const sql = require('mssql');
const pdfkit = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { simpleGit } = require('simple-git');
const git = simpleGit();
const { getConnection } = require('./database');
const { generateXmlReport } = require('./reportXml');
const { generatePdfReport } = require('./reportPdf');
const { MessageMedia } = require('whatsapp-web.js');

const userState = {}; // Controle de estado por usuário
const processingUsers = new Set(); // Para evitar execuções simultâneas para o mesmo usuário

// Função melhorada para obter o ID da carteira por código
async function getCarteiraIdPorCodigo(usuario, codigo) {
  try {
    // Converter o código para número e garantir que seja um valor inteiro
    const codigoInt = parseInt(codigo, 10);
    
    if (isNaN(codigoInt)) {
      console.error(`Código de carteira inválido: ${codigo}`);
      return null;
    }
    
    console.log(`Buscando carteira com código EXATO: ${codigoInt} (tipo: ${typeof codigoInt})`);
    
    const pool = await getConnection();
    const result = await pool.request()
      .input('Usuario', sql.NVarChar, usuario)
      .input('Codigo', sql.Int, codigoInt)  // Usar sql.Int para garantir comparação numérica exata
      .query(`
        SELECT TOP 1 ID 
        FROM Carteiras 
        WHERE Codigo = @Codigo  -- Comparação exata
        AND (Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL)
        ORDER BY Usuario DESC
      `);
    
    if (result.recordset.length === 0) {
      console.log(`Nenhuma carteira encontrada com código ${codigoInt} para usuário ${usuario}`);
      return null;
    }
    
    console.log(`Carteira encontrada - ID: ${result.recordset[0].ID}, Código: ${codigoInt}`);
    return result.recordset[0].ID;
  } catch (error) {
    console.error('Erro ao obter ID da carteira:', error);
    return null;
  }
}

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
  
      // Verificar e remover o arquivo de lock do Git se existir
      const lockPath = path.join(this.repoPath, '../.git/index.lock');
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          console.log('Arquivo de lock do Git removido');
        } catch (unlinkError) {
          console.log('Erro ao remover arquivo de lock:', unlinkError);
        }
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
      return `https://github.com/renatobalbo/chatbot/raw/reports/github-reports/${fileName}`;
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

// Funções para processamento de datas
function isValidDate(dateStr) {
  // Verifica formato DD/MM/YYYY
  const date = dateStr.match(/^\d{2}\/\d{2}\/\d{4}$/);
  if (!date) return false;
  
  const [day, month, year] = dateStr.split('/').map(Number);
  const parsedDate = new Date(year, month - 1, day);
  return parsedDate.getDate() === day && 
         parsedDate.getMonth() === month - 1 && 
         parsedDate.getFullYear() === year;
}

function convertToISO(dateStr, isEndDate = false) {
  if (dateStr.toLowerCase() === 'hoje') {
    // Se for "hoje", retorna a data atual em formato ISO
    const today = new Date();
    if (isEndDate) {
      // Para data final, configura para o final do dia (23:59:59)
      today.setHours(23, 59, 59, 999);
    }
    return today.toISOString().split('.')[0].replace('T', ' '); // Formato YYYY-MM-DD HH:MM:SS
  }
  
  const [day, month, year] = dateStr.split('/');
  
  if (isEndDate) {
    // Para data final, retorna com horário 23:59:59
    return `${year}-${month}-${day} 23:59:59`;
  } else {
    // Para data inicial, retorna com horário 00:00:00
    return `${year}-${month}-${day} 00:00:00`;
  }
}

function formatDateToBR(date) {
  // Converte uma data para o formato brasileiro DD/MM/YYYY
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

// Função para calcular períodos predefinidos
function calcularPeriodoPredefinido(opcao) {
  const hoje = new Date();
  let dataInicio = new Date();
  
  switch (opcao) {
    case '1': // Últimos 15 dias
      dataInicio.setDate(hoje.getDate() - 15);
      break;
    case '2': // Últimos 30 dias
      dataInicio.setDate(hoje.getDate() - 30);
      break;
    case '3': // Últimos 90 dias
      dataInicio.setDate(hoje.getDate() - 90);
      break;
    default:
      dataInicio.setDate(hoje.getDate() - 30); // Padrão para 30 dias
  }
  
  return {
    dataInicio: formatDateToBR(dataInicio),
    dataFim: formatDateToBR(hoje)
  };
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
  const user = msg.from;
  
  // Verificar se já existe um processo em execução para este usuário
  if (processingUsers.has(user)) {
    console.log(`Operação já em andamento para o usuário ${user}`);
    return;
  }
  
  // Marcar este usuário como em processamento
  processingUsers.add(user);
  
  try {
    const fileHosting = new FileHostingService('./github-reports');
    
    // Inicializa repositório de hospedagem
    await fileHosting.initializeRepository();
    
    // Inicialize o estado do usuário apenas se ele não existir
    if (!userState[user]) {
      userState[user] = { etapa: 'carteira', carteira: null, periodo: null };
    }

    // Processo em etapas sequenciais sem recursão
    let continueFlow = true;
    
    // Etapa 1: Verificação de carteira
    if (continueFlow && userState[user].etapa === 'carteira') {
      console.log(`Processando etapa carteira para ${user}`);
      
      const pool = await getConnection();
      const carteirasResult = await pool.request()
        .input('usuario', sql.VarChar, user)
        .query(`
          SELECT Codigo, Descricao, ID
          FROM Carteiras
          WHERE Usuario = @usuario
          UNION ALL
          SELECT 1 AS Codigo, 'Geral' AS Descricao, NULL AS ID
          ORDER BY Codigo
        `);

      const carteiras = carteirasResult.recordset;
      if (carteiras.length === 0) {
        await client.sendMessage(user, 'Você não tem carteiras cadastradas. Cadastre uma antes de gerar o extrato.');
        delete userState[user];
        continueFlow = false;
      } else {
        // Verificar carteiras do usuário (excluindo a Geral)
        const carteirasDoUsuario = carteiras.filter(c => c.Codigo !== 1);
        
        // Se tiver apenas a carteira Geral ou ela + exatamente uma carteira pessoal
        if (carteiras.length === 1 || (carteiras.length === 2 && carteirasDoUsuario.length === 1)) {
          // Seleciona automaticamente a Geral se só houver ela, ou a carteira pessoal se houver apenas uma
          if (carteiras.length === 1) {
            // Se só tem uma carteira (provavelmente a Geral)
            userState[user].carteira = carteiras[0].Codigo;
          } else {
            // Se tem duas carteiras (Geral + uma pessoal), seleciona a pessoal
            const carteiraPessoal = carteirasDoUsuario[0];
            userState[user].carteira = carteiraPessoal.Codigo;
          }
          userState[user].etapa = 'opcao_periodo';
          console.log(`Carteira selecionada automaticamente: ${userState[user].carteira}`);
        } else {
          // Caso tenha mais de uma carteira, pergunta qual utilizar
          let carteirasMsg = 'Escolha uma carteira:\n';
          carteiras.forEach(c => {
            carteirasMsg += `${c.Codigo} - ${c.Descricao}\n`;
          });

          const carteiraMsg = await getUserResponse(client, user, carteirasMsg);
          const carteiraSelecionada = carteiraMsg.body.trim();
          
          console.log(`Carteira selecionada pelo usuário: "${carteiraSelecionada}"`);
          console.log('Carteiras disponíveis:', carteiras.map(c => `"${c.Codigo}"`));
          
          // Verificar se a carteira selecionada existe na lista (com tratamento melhorado)
          const carteiraCodigoInt = parseInt(carteiraSelecionada, 10);
          
          if (isNaN(carteiraCodigoInt)) {
            await client.sendMessage(user, 'Código de carteira inválido. Por favor, escolha um número da lista.');
            processingUsers.delete(user);
            return;
          }
          
          const carteiraEncontrada = carteiras.find(c => c.Codigo === carteiraCodigoInt);
          
          if (!carteiraEncontrada) {
            await client.sendMessage(user, 'Carteira inválida. Por favor, escolha uma carteira da lista.');
            processingUsers.delete(user);
            return;
          }
          
          userState[user].carteira = carteiraEncontrada.Codigo;
          userState[user].etapa = 'opcao_periodo';
          console.log(`Usuário selecionou carteira: ${userState[user].carteira}`);
        }
      }
    }

    // NOVA ETAPA: Opções de período
    if (continueFlow && userState[user].etapa === 'opcao_periodo') {
      console.log(`Processando etapa opção de período para ${user}`);
      
      const opcoesPeriodoMsg = 
        'Escolha o período do extrato:\n' +
        '1 - Últimos 15 dias\n' +
        '2 - Últimos 30 dias\n' +
        '3 - Últimos 90 dias\n' +
        '4 - Período específico';
        
      const opcaoMsg = await getUserResponse(client, user, opcoesPeriodoMsg);
      const opcao = opcaoMsg.body.trim();
      
      if (['1', '2', '3'].includes(opcao)) {
        // Opção predefinida
        userState[user].periodo = calcularPeriodoPredefinido(opcao);
        userState[user].etapa = 'finalizado';
        
        await client.sendMessage(user, 
          `Período selecionado: ${userState[user].periodo.dataInicio} a ${userState[user].periodo.dataFim}`);
          
      } else if (opcao === '4') {
        // Período específico - avança para etapa de definição do período
        userState[user].etapa = 'periodo';
        
      } else {
        // Opção inválida
        await client.sendMessage(user, 'Opção inválida. Por favor, escolha uma opção entre 1 e 4.');
        userState[user].etapa = 'opcao_periodo'; // Mantém na mesma etapa
        processingUsers.delete(user);
        return;
      }
    }

    // Etapa 2: Informação de período (apenas se escolher período específico)
    if (continueFlow && userState[user].etapa === 'periodo') {
      console.log(`Processando etapa período específico para ${user}`);
      
      if (!userState[user].periodo) {
        const dataAtual = formatDateToBR(new Date());
        
        const periodoMsg = await getUserResponse(
          client, 
          user, 
          'Informe o período desejado (formato: DD/MM/YYYY a DD/MM/YYYY):\n' +
          'Você pode usar a palavra "hoje" para a data final, por exemplo: 01/01/2025 a hoje\n' +
          `Obs: O período máximo permitido é de 90 dias.`
        );
        
        const periodoInput = periodoMsg.body;
        let periodo;
        
        // Verificar se contém "a hoje"
        if (periodoInput.toLowerCase().includes(' a hoje')) {
          const dataInicio = periodoInput.toLowerCase().split(' a hoje')[0].trim();
          periodo = [dataInicio, 'hoje'];
        } else {
          periodo = periodoInput.split(' a ');
        }

        if (periodo.length !== 2) {
          await client.sendMessage(user, 'Formato de período inválido. Por favor, use o formato DD/MM/YYYY a DD/MM/YYYY ou DD/MM/YYYY a hoje.');
          processingUsers.delete(user);
          return;
        }

        let [dataInicio, dataFim] = periodo;
        
        // Se dataFim for "hoje", substituir pela data atual
        if (dataFim.toLowerCase() === 'hoje') {
          dataFim = dataAtual;
        }

        // Validar formato das datas
        if (!isValidDate(dataInicio) || !isValidDate(dataFim)) {
          await client.sendMessage(user, 'Formato de data inválido. Por favor, use o formato DD/MM/YYYY.');
          processingUsers.delete(user);
          return;
        }
        
        // Converter para objetos Date para validação
        const dataInicioObj = new Date(convertToISO(dataInicio));
        const dataFimObj = new Date(convertToISO(dataFim));
        const hoje = new Date();
        hoje.setHours(23, 59, 59, 999); // Final do dia de hoje
        
        // Verificar se data final é maior que a data inicial
        if (dataFimObj < dataInicioObj) {
          await client.sendMessage(user, 'A data final deve ser maior ou igual à data inicial.');
          processingUsers.delete(user);
          return;
        }
        
        // Verificar se data final é maior que hoje
        if (dataFimObj > hoje) {
          await client.sendMessage(user, 'A data final não pode ser maior que hoje.');
          processingUsers.delete(user);
          return;
        }
        
        // Verificar se período é maior que 90 dias
        const diffTime = Math.abs(dataFimObj - dataInicioObj);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 90) {
          await client.sendMessage(user, 'O período máximo permitido é de 90 dias.');
          processingUsers.delete(user);
          return;
        }

        userState[user].periodo = { dataInicio, dataFim };
        userState[user].etapa = 'finalizado';
      }
    }

    // Etapa 3: Geração do relatório
    if (continueFlow && userState[user].etapa === 'finalizado') {
      console.log(`Gerando relatório para ${user}`);
      
      const { carteira, periodo } = userState[user];
      const dataInicioISO = convertToISO(periodo.dataInicio, false);
      const dataFimISO = convertToISO(periodo.dataFim, true);

      const pool = await getConnection();

      // Processamento do ID da carteira
      let carteiraId = null;

      // Log para debug
      console.log(`Carteira antes da validação: "${carteira}", tipo: ${typeof carteira}`);

      // Garantir que carteira seja um número
      const carteiraCodigo = parseInt(String(carteira).trim(), 10);

      if (isNaN(carteiraCodigo)) {
        console.error(`Código de carteira inválido: ${carteira}`);
        await client.sendMessage(user, 'Código de carteira inválido. Por favor, tente novamente.');
        processingUsers.delete(user);
        delete userState[user];
        return;
      }

      console.log(`Carteira convertida para número: ${carteiraCodigo}`);

      // Obter o ID da carteira correspondente ao código
      const carteiraResult = await pool.request()
        .input('Usuario', sql.VarChar, user)
        .input('Codigo', sql.Int, carteiraCodigo)
        .query(`
          SELECT TOP 1 ID, Codigo, Descricao 
          FROM Carteiras 
          WHERE Codigo = @Codigo AND (Usuario = @Usuario OR Usuario = 'GERAL')
          ORDER BY Usuario DESC
        `);
      
      if (carteiraResult.recordset.length > 0) {
        carteiraId = carteiraResult.recordset[0].ID;
        console.log(`ID da carteira ${carteiraCodigo} encontrado: ${carteiraId}`);
        console.log(`Descrição da carteira: ${carteiraResult.recordset[0].Descricao}`);
      } else {
        console.log(`Nenhuma carteira encontrada com código ${carteiraCodigo}`);
        await client.sendMessage(user, 'Carteira não encontrada. Por favor, tente novamente.');
        processingUsers.delete(user);
        delete userState[user];
        return;
      }

      // Verificação adicional: contar apenas as movimentações da carteira selecionada 
      const verificaMovs = await pool.request()
        .input('usuario', sql.VarChar, user)
        .input('carteiraId', sql.Int, carteiraId)
        .query(`
          SELECT COUNT(*) AS Total,
                 SUM(CASE WHEN Tipo = 'Crédito' THEN Valor ELSE 0 END) AS SomaCreditos,
                 SUM(CASE WHEN Tipo = 'Débito' THEN Valor ELSE 0 END) AS SomaDebitos
          FROM Movimentacoes 
          WHERE Usuario = @usuario AND Carteira = @carteiraId
        `);
      
      console.log(`Verificação: ${verificaMovs.recordset[0].Total} movimentações encontradas para a carteira ID ${carteiraId}`);
      console.log(`Soma de Créditos: ${verificaMovs.recordset[0].SomaCreditos || 0}`);
      console.log(`Soma de Débitos: ${verificaMovs.recordset[0].SomaDebitos || 0}`);

      // Consulta para obter as movimentações com JOIN para carteiras
      let consultaSQL = `
        SELECT 
          CONVERT(varchar, m.Data, 103) AS Data, 
          m.Valor, 
          m.Tipo, 
          m.Categoria,
          CONCAT(m.Categoria, '-', ISNULL(c.Descricao, 'Sem descrição')) AS CategoriaDescricao,
          car.Codigo AS CarteiraCodigo,
          car.Descricao AS CarteiraDescricao
        FROM Movimentacoes m
        LEFT JOIN Categorias c ON m.Categoria = c.Codigo 
             AND (c.Usuario = @usuario OR c.Usuario = 'GERAL')
        LEFT JOIN Carteiras car ON m.Carteira = car.ID
        WHERE m.Usuario = @usuario
        AND m.Carteira = @carteiraId
        AND m.Data BETWEEN @dataInicio AND @dataFim
        ORDER BY m.Data ASC
      `;

      console.log(`Executando consulta SQL com os parâmetros: 
        usuario: ${user} 
        carteiraId: ${carteiraId} 
        dataInicio: ${dataInicioISO} 
        dataFim: ${dataFimISO}`);
      
      const result = await pool.request()
        .input('usuario', sql.VarChar, user)
        .input('carteiraId', sql.Int, carteiraId)
        // Modificar estes parâmetros:
        .input('dataInicio', sql.DateTime, dataInicioISO)  // Agora aceita hora
        .input('dataFim', sql.DateTime, dataFimISO)        // Inclui hora 23:59:59
        .query(consultaSQL);

      const movimentacoes = result.recordset;
      console.log(`Encontradas ${movimentacoes.length} movimentações para o período`);

      // Log detalhado das primeiras movimentações para verificação
      if (movimentacoes.length > 0) {
        console.log("Amostra das movimentações encontradas:");
        for (let i = 0; i < Math.min(3, movimentacoes.length); i++) {
          console.log(`Mov ${i+1}: Data=${movimentacoes[i].Data}, Valor=${movimentacoes[i].Valor}, Carteira=${movimentacoes[i].CarteiraCodigo}-${movimentacoes[i].CarteiraDescricao}`);
        }
      }

      const reportsDir = path.join(__dirname, 'github-reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir);
      }

      const fileName = buildReportFileName(user, format);
      const filePath = path.join(reportsDir, fileName);

      if (format === 'pdf') {
        // Passar todos os parâmetros necessários incluindo o usuario e carteiraId
        await generatePdfReport(movimentacoes, carteiraCodigo, periodo, filePath, user, carteiraId);
      } else if (format === 'xml') {
        await generateXmlReport(movimentacoes, carteiraCodigo, periodo, filePath);
      }

      try {
        // Hospedar arquivo no GitHub
        const publicUrl = await fileHosting.hostFile(filePath, fileName);

        // Verificar se publicUrl existe e é válido
        if (publicUrl) {
          // Enviar mensagem com URL do arquivo
          const media = await MessageMedia.fromUrl(publicUrl);
          await client.sendMessage(user, media);
        } else {
          // Se a URL for null ou inválida, envia o arquivo diretamente
          const mediaLocal = MessageMedia.fromFilePath(filePath);
          await client.sendMessage(user, mediaLocal, {
            caption: 'Seu relatório está pronto.'
          });
        }
      } catch (uploadError) {
        console.error('Erro ao tentar hospedar/enviar arquivo:', uploadError);
        // Fallback para envio local em caso de erro no GitHub
        try {
          const mediaLocal = MessageMedia.fromFilePath(filePath);
          await client.sendMessage(user, mediaLocal, {
            caption: 'Seu relatório está pronto (enviado localmente devido a um erro no upload).'
          });
        } catch (localError) {
          console.error('Erro ao enviar arquivo localmente:', localError);
          await client.sendMessage(user, 'Não foi possível enviar o relatório. Por favor, tente novamente mais tarde.');
        }
      }

      // Limpar arquivos antigos
      await fileHosting.cleanupOldFiles();

      // Limpar o estado do usuário após concluir o relatório
      delete userState[user];
    }
  } catch (error) {
    console.error('Erro ao gerar relatório:', error);
    await client.sendMessage(msg.from, 'Ocorreu um erro ao gerar o relatório. Por favor, tente novamente.');
    delete userState[msg.from];
  } finally {
    // Remover o usuário da lista de processamento, independente do resultado
    processingUsers.delete(user);
  }
}

module.exports = { generateStatementReport };
