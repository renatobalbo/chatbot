const pdfkit = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { getConnection, sql } = require('./database');

// Função para obter ID da carteira pelo código garantindo comparação exata
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

// Função para obter saldo atual da carteira garantindo comparação exata
async function obterSaldoAtualCarteira(usuario, carteiraId) {
  try {
    if (!carteiraId) {
      console.log('ID da carteira não fornecido para cálculo de saldo');
      return 0;
    }
    
    // Converter para número e garantir que é um inteiro válido
    const carteiraIdInt = parseInt(carteiraId, 10);
    
    if (isNaN(carteiraIdInt)) {
      console.error(`ID de carteira inválido: ${carteiraId}`);
      return 0;
    }
    
    console.log(`Calculando saldo para carteira ID EXATO: ${carteiraIdInt} (tipo: ${typeof carteiraIdInt})`);
    
    const pool = await getConnection();
    
    // Consulta de depuração: verificar se há movimentações para esta carteira
    const checkMovs = await pool.request()
      .input('Usuario', sql.VarChar, usuario)
      .input('Carteira', sql.Int, carteiraIdInt)
      .query(`
        SELECT COUNT(*) AS TotalMovs, 
               SUM(CASE WHEN Tipo = 'Crédito' THEN 1 ELSE 0 END) AS TotalCreditos,
               SUM(CASE WHEN Tipo = 'Débito' THEN 1 ELSE 0 END) AS TotalDebitos
        FROM Movimentacoes 
        WHERE Usuario = @Usuario AND Carteira = @Carteira
      `);
    
    console.log(`Movimentações encontradas para carteira ${carteiraIdInt}:`, 
                `Total: ${checkMovs.recordset[0].TotalMovs}, `,
                `Créditos: ${checkMovs.recordset[0].TotalCreditos}, `,
                `Débitos: ${checkMovs.recordset[0].TotalDebitos}`);
    
    // Consulta principal: calcular saldo
    const result = await pool.request()
      .input('Usuario', sql.VarChar, usuario)
      .input('Carteira', sql.Int, carteiraIdInt)
      .query(`
        SELECT 
          (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Carteira = @Carteira AND Tipo = 'Crédito') -
          (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Carteira = @Carteira AND Tipo = 'Débito') 
        AS Saldo
      `);
    
    const saldo = result.recordset[0]?.Saldo ?? 0;
    console.log(`Saldo calculado para carteira ${carteiraIdInt}: ${saldo}`);
    return saldo;
  } catch (error) {
    console.error('Erro ao obter saldo atual da carteira:', error);
    return 0;
  }
}

// Função para obter descrição da carteira
async function obterDescricaoCarteira(usuario, codigo) {
  try {
    if (!codigo) {
      return "Carteira não especificada";
    }
    
    // Converter para número
    const codigoInt = parseInt(codigo, 10);
    
    if (isNaN(codigoInt)) {
      console.error(`Código de carteira inválido para obter descrição: ${codigo}`);
      return `Carteira ${codigo}`;
    }
    
    console.log(`Buscando descrição da carteira código ${codigoInt} para usuário ${usuario}`);
    
    const pool = await getConnection();
    const result = await pool.request()
      .input('Usuario', sql.NVarChar, usuario)
      .input('Codigo', sql.Int, codigoInt)
      .query(`
        SELECT TOP 1 Descricao 
        FROM Carteiras 
        WHERE Codigo = @Codigo
        AND (Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL)
        ORDER BY Usuario DESC
      `);
    
    if (result.recordset.length === 0) {
      return `Carteira ${codigo}`;
    }
    
    return result.recordset[0].Descricao;
  } catch (error) {
    console.error('Erro ao obter descrição da carteira:', error);
    return `Carteira ${codigo}`;
  }
}

async function generatePdfReport(movimentacoes, carteira, periodo, filePath, usuario, carteiraId) {
  // Obter o saldo atual da carteira
  let saldoAtual = 0;
  let descricaoCarteira = '';
  
  try {
    // Obter descrição da carteira
    descricaoCarteira = await obterDescricaoCarteira(usuario, carteira);
    console.log(`Descrição da carteira obtida: ${descricaoCarteira}`);
    
    if (carteiraId) {
      // Usar nova função para obter saldo atual
      saldoAtual = await obterSaldoAtualCarteira(usuario, carteiraId);
    } else if (carteira === '1' || carteira === 1) {
      // Caso especial: Carteira Geral (código 1) - somar todas as movimentações do usuário
      console.log(`Consultando saldo geral para o usuário ${usuario}`);
      
      const pool = await getConnection();
      const result = await pool.request()
        .input('Usuario', sql.VarChar, usuario)
        .query(`
          SELECT 
            (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Tipo = 'Crédito') -
            (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Tipo = 'Débito') 
          AS Saldo
        `);
      
      saldoAtual = result.recordset[0]?.Saldo ?? 0;
      console.log(`Saldo geral obtido: ${saldoAtual}`);
    } else {
      // Se por algum motivo não temos o carteiraId, vamos tentar obtê-lo novamente
      console.log(`Tentando obter ID da carteira com código ${carteira} para usuário ${usuario}`);
      
      // Converter para inteiro para garantir comparação exata
      const carteiraInt = parseInt(carteira, 10);
      if (isNaN(carteiraInt)) {
        console.error(`Código de carteira inválido para conversão: ${carteira}`);
      } else {
        const carteiraIdObtido = await getCarteiraIdPorCodigo(usuario, carteiraInt);
        if (carteiraIdObtido) {
          saldoAtual = await obterSaldoAtualCarteira(usuario, carteiraIdObtido);
        } else {
          console.log(`Não foi possível determinar a carteira para consulta de saldo. Código: ${carteira}`);
        }
      }
    }
  } catch (error) {
    console.error('Erro ao obter saldo atual da carteira:', error);
  }

  return new Promise((resolve, reject) => {
    // Configuração inicial do documento
    const doc = new pdfkit({
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      size: 'A4',
      bufferPages: true,
      pdfVersion: '1.4',
      compress: true,
      autoFirstPage: true,
      info: {
        Title: `Extrato da ${descricaoCarteira || `Carteira ${carteira}`}`,
        Author: 'Chatbot Financeiro',
        Subject: `Extrato financeiro - período: ${periodo.dataInicio} a ${periodo.dataFim}`
      }
    });
    
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    // Cores e estilos
    const corPrimaria = '#336699';
    const corSecundaria = '#f5f5f5';
    const corCredito = '#009933';
    const corDebito = '#cc3300';
    
    // ===== PRIMEIRA PÁGINA: EXTRATO DE MOVIMENTAÇÕES =====
    adicionarCabecalho(doc, descricaoCarteira || `Carteira ${carteira}`, periodo);
    
    if (movimentacoes && movimentacoes.length > 0) {
      doc.moveDown(1);
      adicionarTabelaMovimentacoes(doc, movimentacoes, corPrimaria, corSecundaria, corCredito, corDebito);
      
      const saldo = calcularSaldo(movimentacoes);
      doc.moveDown(1);
      adicionarSaldoFinal(doc, saldo, corPrimaria, saldo >= 0 ? corCredito : corDebito, saldoAtual);
    } else {
      doc.moveDown(2);
      doc.font('Helvetica')
         .fontSize(12)
         .fillColor('black')
         .text('Não há movimentações no período selecionado.', {
           align: 'center'
         });
    }
    
    // ===== SEGUNDA PÁGINA: RESUMO POR CATEGORIA =====
    if (movimentacoes && movimentacoes.length > 0) {
      const resumoCategorias = calcularResumoCategorias(movimentacoes);
      
      if (Object.keys(resumoCategorias).length > 0) {
        doc.addPage();
        adicionarCabecalho(doc, descricaoCarteira || `Carteira ${carteira}`, periodo, 'Resumo por Categoria');
        
        doc.moveDown(1);
        adicionarResumoCategorias(doc, resumoCategorias, corPrimaria, corSecundaria, corCredito, corDebito);
        
        if (Object.keys(resumoCategorias).length > 0) {
          doc.moveDown(1);
          adicionarGraficoDistribuicao(doc, resumoCategorias, corPrimaria);
        }
      }
    }
    
    // Função para adicionar cabeçalho
    function adicionarCabecalho(doc, carteiraDescricao, periodo, titulo = 'Extrato da Carteira') {
      // Usa font padrão para melhor compatibilidade
      doc.font('Helvetica-Bold');
      
      // Retângulo de fundo para o cabeçalho - cores sólidas
      doc.rect(50, 50, doc.page.width - 100, 70)
         .fillColor(corPrimaria)
         .fill();
      
      // Título principal
      doc.fontSize(18)
         .fillColor('white')
         .text(`${titulo} ${carteiraDescricao}`, 60, 65, { 
           align: 'center', 
           width: doc.page.width - 120 
         });
      
      // Período
      doc.fontSize(11)
         .text(`Período: ${periodo.dataInicio} a ${periodo.dataFim}`, 60, 95, { 
           align: 'center', 
           width: doc.page.width - 120 
         });
      
      // Linha horizontal abaixo do cabeçalho
      doc.moveTo(50, 130)
         .lineTo(doc.page.width - 50, 130)
         .strokeColor('#cccccc')
         .stroke();
         
      // Posicionamento após o cabeçalho
      doc.y = 140;
    }

    // Função para adicionar tabela de movimentações
    function adicionarTabelaMovimentacoes(doc, movimentacoes, corPrimaria, corSecundaria, corCredito, corDebito) {
      // Retorna ao font padrão
      doc.font('Helvetica');
      
      // Título da seção
      doc.fillColor('black')
         .fontSize(14)
         .text('Detalhamento de Movimentações', { align: 'left' });
         
      doc.y += 10;
      
      // Definir larguras das colunas
      const margemEsquerda = 50;
      const larguraPagina = doc.page.width - 100;
      const colData = larguraPagina * 0.2;
      const colValor = larguraPagina * 0.25;
      const colTipo = larguraPagina * 0.15;
      const colCategoria = larguraPagina * 0.4;
      
      // Cabeçalhos da tabela
      const yHeader = doc.y;
      doc.rect(margemEsquerda, yHeader, larguraPagina, 20)
         .fillColor(corPrimaria)
         .fill();
      
      doc.fillColor('white')
         .fontSize(10)
         .text('Data', margemEsquerda + 5, yHeader + 5, { width: colData });
         
      doc.text('Valor', margemEsquerda + colData + 5, yHeader + 5, { 
        width: colValor, 
        align: 'right' 
      });
      
      doc.text('Tipo', margemEsquerda + colData + colValor + 5, yHeader + 5, { 
        width: colTipo, 
        align: 'center' 
      });
      
      doc.text('Categoria', margemEsquerda + colData + colValor + colTipo + 5, yHeader + 5, { 
        width: colCategoria - 10
      });
      
      doc.y = yHeader + 20;
      
      // Verificar se precisamos de uma nova página para a tabela
      if (doc.y > doc.page.height - 120) {
        doc.addPage();
        doc.y = 50;
      }
      
      // Linhas da tabela
      let linhaAlternada = false;
      
      for (let i = 0; i < movimentacoes.length; i++) {
        const mov = movimentacoes[i];
        
        // Verificar se precisamos de uma nova página
        if (doc.y > doc.page.height - 120) {
          doc.addPage();
          doc.y = 50;
          
          // Re-adicionar o cabeçalho da tabela na nova página
          const yHeader = doc.y;
          doc.rect(margemEsquerda, yHeader, larguraPagina, 20)
             .fillColor(corPrimaria)
             .fill();
          
          doc.fillColor('white')
             .fontSize(10)
             .text('Data', margemEsquerda + 5, yHeader + 5, { width: colData });
          doc.text('Valor', margemEsquerda + colData + 5, yHeader + 5, { width: colValor, align: 'right' });
          doc.text('Tipo', margemEsquerda + colData + colValor + 5, yHeader + 5, { width: colTipo, align: 'center' });
          doc.text('Categoria', margemEsquerda + colData + colValor + colTipo + 5, yHeader + 5, { width: colCategoria - 10 });
          
          doc.y = yHeader + 20;
        }
        
        const alturaLinha = 20;
        const yPos = doc.y;
        
        // Fundo alternado
        if (linhaAlternada) {
          doc.rect(margemEsquerda, yPos, larguraPagina, alturaLinha)
             .fillColor(corSecundaria)
             .fill();
        }
        linhaAlternada = !linhaAlternada;
        
        // Dados da linha
        doc.fillColor('black')
           .fontSize(9)
           .text(formatarData(mov.Data), margemEsquerda + 5, yPos + 5, { width: colData });
        
        // Valor colorido de acordo com o tipo
        doc.fillColor(mov.Tipo === 'Crédito' ? corCredito : corDebito)
           .text(formatarValor(mov.Valor), margemEsquerda + colData + 5, yPos + 5, { 
             width: colValor, 
             align: 'right' 
           });
        
        // Tipo e categoria
        doc.fillColor('black')
           .text(mov.Tipo, margemEsquerda + colData + colValor + 5, yPos + 5, { 
             width: colTipo, 
             align: 'center' 
           });
           
        // Extrair apenas a descrição da categoria (remover o código)
        let categoriaTexto = mov.CategoriaDescricao || '';
        if (categoriaTexto.includes('-')) {
          categoriaTexto = categoriaTexto.split('-').slice(1).join('-').trim();
        }
       
        doc.text(categoriaTexto, margemEsquerda + colData + colValor + colTipo + 5, yPos + 5, { 
          width: colCategoria - 10 
        });
        
        doc.y = yPos + alturaLinha;
      }
    }

    // Função para adicionar saldo final e saldo atual
    function adicionarSaldoFinal(doc, saldo, corPrimaria, corSaldo, saldoAtual) {
      // Verificar espaço disponível
      if (doc.y > doc.page.height - 140) { // Aumentado para comportar 2 linhas
        doc.addPage();
        doc.y = 50;
      }
      
      // Retângulo de destaque para ambos os saldos
      const retanguloX = doc.page.width - 270;
      const retanguloY = doc.y;
      
      doc.rect(retanguloX, retanguloY, 220, 60) // Altura aumentada para acomodar duas linhas
         .fillColor(corPrimaria)
         .fill();
      
      // Texto e valor do saldo do período
      doc.fillColor('white')
         .fontSize(11)
         .text('Saldo final do período:', retanguloX + 10, retanguloY + 8, { width: 130 });
      
      doc.fillColor('white')
         .fontSize(11)
         .text(formatarValor(saldo), retanguloX + 140, retanguloY + 8, { 
           width: 70,
           align: 'right' 
         });
      
      // Adicionar linha separadora
      doc.moveTo(retanguloX + 10, retanguloY + 30)
         .lineTo(retanguloX + 210, retanguloY + 30)
         .strokeColor('white')
         .stroke();
         
      // Texto e valor do saldo atual
      doc.fillColor('white')
         .fontSize(11)
         .text('Saldo atual da carteira:', retanguloX + 10, retanguloY + 38, { width: 130 });
      
      doc.fillColor('white')
         .fontSize(11)
         .text(formatarValor(saldoAtual), retanguloX + 140, retanguloY + 38, { 
           width: 70,
           align: 'right' 
         });
      
      // Atualizar a posição Y
      doc.y = retanguloY + 70;
    }

    // Função para adicionar resumo por categorias com separação de código e descrição
    function adicionarResumoCategorias(doc, resumoCategorias, corPrimaria, corSecundaria, corCredito, corDebito) {
      // Retorna ao font padrão
      doc.font('Helvetica');
      
      // Título da seção
      doc.fillColor('black')
         .fontSize(14)
         .text('Detalhamento por Categoria', { align: 'left' });
      
      doc.y += 10;
      
      // Definir larguras das colunas
      const margemEsquerda = 50;
      const larguraPagina = doc.page.width - 100;
      const colCodigo = larguraPagina * 0.15;
      const colCategoria = larguraPagina * 0.5;
      const colValor = larguraPagina * 0.35;
      
      // Cabeçalhos da tabela
      const yHeader = doc.y;
      
      doc.rect(margemEsquerda, yHeader, larguraPagina, 20)
         .fillColor(corPrimaria)
         .fill();
      
      doc.fillColor('white')
         .fontSize(10)
         .text('Código', margemEsquerda + 5, yHeader + 5, { width: colCodigo });
         
      doc.text('Categoria', margemEsquerda + colCodigo + 5, yHeader + 5, { 
        width: colCategoria 
      });
      
      doc.text('Total', margemEsquerda + colCodigo + colCategoria + 5, yHeader + 5, { 
        width: colValor - 10, 
        align: 'right' 
      });
      
      doc.y = yHeader + 20;
      
      // Converter para um array e ordenar por código
      const categoriasSorted = Object.entries(resumoCategorias).map(([chave, info]) => ({
        codigo: info.codigo,
        categoria: info.descricao,
        total: info.total
      })).sort((a, b) => a.codigo - b.codigo);
      
      // Linhas da tabela
      let linhaAlternada = false;
      let totalGeral = 0;
      
      for (let i = 0; i < categoriasSorted.length; i++) {
        const item = categoriasSorted[i];
        totalGeral += item.total;
        
        // Verificar se precisamos de uma nova página
        if (doc.y > doc.page.height - 120) {
          doc.addPage();
          doc.y = 50;
          
          // Re-adicionar o cabeçalho da tabela na nova página
          const yHeader = doc.y;
          doc.rect(margemEsquerda, yHeader, larguraPagina, 20)
             .fillColor(corPrimaria)
             .fill();
          
          doc.fillColor('white')
             .fontSize(10)
             .text('Código', margemEsquerda + 5, yHeader + 5, { width: colCodigo });
          doc.text('Categoria', margemEsquerda + colCodigo + 5, yHeader + 5, { width: colCategoria });
          doc.text('Total', margemEsquerda + colCodigo + colCategoria + 5, yHeader + 5, { 
            width: colValor - 10, 
            align: 'right' 
          });
          
          doc.y = yHeader + 20;
        }
        
        const alturaLinha = 20;
        const yPos = doc.y;
        
        // Fundo alternado
        if (linhaAlternada) {
          doc.rect(margemEsquerda, yPos, larguraPagina, alturaLinha)
             .fillColor(corSecundaria)
             .fill();
        }
        linhaAlternada = !linhaAlternada;
        
        // Dados da linha - Agora código e categoria estão separados
        doc.fillColor('black')
           .fontSize(9)
           .text(item.codigo.toString(), margemEsquerda + 5, yPos + 5, { 
             width: colCodigo 
           });
           
        doc.text(item.categoria, margemEsquerda + colCodigo + 5, yPos + 5, { 
          width: colCategoria 
        });
        
        // Valor com cor
        doc.fillColor(item.total >= 0 ? corCredito : corDebito)
           .text(formatarValor(item.total), margemEsquerda + colCodigo + colCategoria + 5, yPos + 5, { 
             width: colValor - 10, 
             align: 'right' 
           });
        
        doc.y = yPos + alturaLinha;
      }
      
      // Verificar espaço para o total geral
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
        doc.y = 50;
      }
      
      // Total geral
      const yTotal = doc.y + 10;
      
      doc.rect(margemEsquerda, yTotal, larguraPagina, 25)
         .fillColor('#222222')
         .fill();
      
      doc.fillColor('white')
         .fontSize(11)
         .text('TOTAL GERAL', margemEsquerda + 5, yTotal + 7, { 
           width: colCodigo + colCategoria 
         });
      
      doc.fillColor('white')
         .text(formatarValor(totalGeral), margemEsquerda + colCodigo + colCategoria + 5, yTotal + 7, { 
           width: colValor - 10, 
           align: 'right' 
         });
      
      doc.y = yTotal + 35;
      return totalGeral;
    }

    // Função para adicionar uma representação gráfica simplificada
    function adicionarGraficoDistribuicao(doc, resumoCategorias, corPrimaria) {
      // Verificar espaço para o gráfico + rodapé
      if (doc.y > doc.page.height - 230) {
        doc.addPage();
        adicionarCabecalho(doc, descricaoCarteira || `Carteira ${carteira}`, periodo, 'Resumo por Categoria');
      }
      
      // Retorna ao font padrão
      doc.font('Helvetica');
      
      // Alinhamento do título
      doc.fillColor('black')
         .fontSize(14)
         .text('Distribuição de Valores', 60, doc.y, { align: 'left' });
      doc.moveDown(0.3);

      // Converter para array e ordenar
      const categoriasOrdenadas = Object.entries(resumoCategorias)
        .map(([chave, info]) => ({
          categoria: info.descricao,
          total: Math.abs(info.total)
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const maiorValor = Math.max(...categoriasOrdenadas.map(item => item.total));
      const larguraGrafico = doc.page.width - 100;
      const alturaMaxBarra = 15;
      const margemBase = 50;

      // Gráfico de barras simplificado
      categoriasOrdenadas.forEach((item, index) => {
        const yPos = doc.y + 5;
        
        // Área de descrição (20% da largura)
        doc.fillColor('black')
           .fontSize(9)
           .text(item.categoria, margemBase, yPos, { 
             width: larguraGrafico * 0.2, 
             align: 'left' 
           });

        // Barra (60% da largura)
        const percentual = item.total / maiorValor;
        const larguraBarra = percentual * larguraGrafico * 0.6;
        const corBarra = obterCorParaCategoria(index, corPrimaria);
        
        doc.rect(
          margemBase + larguraGrafico * 0.2 + 10, // Espaçamento de 10px
          yPos,
          larguraBarra,
          alturaMaxBarra
        ).fillColor(corBarra).fill();

        // Valor (10% da largura)
        doc.fillColor('black')
           .text(
             formatarValor(item.total),
             margemBase + larguraGrafico * 0.2 + larguraBarra + 20, // Posição ajustada
             yPos + 2,
             { 
               width: larguraGrafico * 0.1,
               align: 'right'
             }
           );
        
        doc.y = yPos + alturaMaxBarra + 5;
      });
    }
    
    // Funções auxiliares
    function calcularSaldo(movimentacoes) {
      return movimentacoes.reduce((acc, mov) => {
        const valor = typeof mov.Valor === 'string' 
          ? parseFloat(mov.Valor.replace(/[^\d,-]/g, '').replace(',', '.')) 
          : parseFloat(mov.Valor);
          
        return acc + (mov.Tipo === 'Crédito' ? valor : -valor);
      }, 0);
    }

    // Extrair o código e a descrição da categoria
    function calcularResumoCategorias(movimentacoes) {
      return movimentacoes.reduce((acc, mov) => {
        // Extrair código e descrição da categoria
        let codigo = 0;
        let descricao = 'Sem categoria';
        
        if (mov.CategoriaDescricao) {
          // Formato esperado: "123-Descrição da Categoria"
          const match = mov.CategoriaDescricao.match(/^(\d+)-(.+)$/);
          if (match) {
            codigo = parseInt(match[1], 10);
            descricao = match[2].trim();
          } else {
            descricao = mov.CategoriaDescricao;
          }
        }
        
        // Chave única baseada na descrição
        const chave = descricao;
        
        if (!acc[chave]) {
          acc[chave] = {
            codigo: codigo,
            descricao: descricao,
            total: 0
          };
        }
        
        const valor = typeof mov.Valor === 'string' 
          ? parseFloat(mov.Valor.replace(/[^\d,-]/g, '').replace(',', '.')) 
          : parseFloat(mov.Valor);
          
        acc[chave].total += mov.Tipo === 'Crédito' ? valor : -valor;
        
        return acc;
      }, {});
    }

    function formatarData(dataStr) {
      if (!dataStr) return '';
      
      // Verifica se a data já está no formato DD/MM/YYYY
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataStr)) {
        return dataStr;
      }
      
      try {
        const data = new Date(dataStr);
        if (isNaN(data.getTime())) return dataStr; // Data inválida
        return data.toLocaleDateString('pt-BR');
      } catch (e) {
        return dataStr; // Retorna a string original em caso de erro
      }
    }

    function formatarValor(valor) {
      if (valor === undefined || valor === null) return 'R$ 0,00';
      
      // Se for string, limpar e converter
      if (typeof valor === 'string') {
        valor = parseFloat(valor.replace(/[^\d,-]/g, '').replace(',', '.'));
      }
      
      if (isNaN(valor)) return 'R$ 0,00';
      
      // Formatar com apenas 2 casas decimais para garantir compatibilidade
      const valorFormatado = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(valor);
      
      return valorFormatado;
    }

    function obterCorParaCategoria(index, corBase) {
      // Array de cores para categorias diferentes
      const cores = [
        corBase, 
        '#4477aa', 
        '#5588bb', 
        '#66aadd', 
        '#77bbee'
      ];
      
      return cores[index % cores.length];
    }
    
    // Finaliza o documento
    doc.end();

    // Garanta que o arquivo esteja completamente escrito antes de resolver a promise
    writeStream.on('finish', () => {
      // Verificação adicional para garantir que o arquivo foi escrito corretamente
      fs.stat(filePath, (err, stats) => {
        if (err) {
          reject(err);
        } else if (stats.size === 0) {
          reject(new Error('Arquivo PDF gerado está vazio'));
        } else {
          console.log(`PDF gerado com sucesso: ${filePath}, tamanho: ${stats.size} bytes`);
          resolve(filePath);
        }
      });
    });
    
    writeStream.on('error', (err) => {
      console.error('Erro ao gravar PDF:', err);
      reject(err);
    });
  });
}

module.exports = { generatePdfReport };
