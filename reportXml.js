const fs = require('fs');
const ExcelJS = require('exceljs');

async function generateXmlReport(movimentacoes, carteira, periodo, filePath) {
  try {
    // Criar diretório de relatórios se não existir
    const reportsDir = './reports';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }

    const workbook = new ExcelJS.Workbook();
    
    // Configurar propriedades do documento (metadados)
    workbook.creator = 'Sistema de Controle Financeiro';
    workbook.lastModifiedBy = 'Sistema de Controle Financeiro';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.properties.date1904 = false;
    workbook.title = `Extrato Financeiro - Carteira ${carteira}`;
    workbook.subject = `Período: ${periodo.dataInicio} a ${periodo.dataFim}`;

    // ===== ABA PRINCIPAL: EXTRATO =====
    const mainSheet = workbook.addWorksheet('Extrato', {
      properties: { tabColor: { argb: '6495ED' } }
    });
    
    // Definir colunas
    mainSheet.columns = [
      { header: 'Data', key: 'Data', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Valor', key: 'Valor', width: 14, style: { numFmt: '"R$ "#,##0.00;[Red]"R$ -"#,##0.00' } },
      { header: 'Tipo', key: 'Tipo', width: 10 },
      { header: 'Categoria', key: 'CategoriaDescricao', width: 22 }
    ];
    
    // Estilizar o cabeçalho
    const headerRow = mainSheet.getRow(1);
    headerRow.font = { bold: true, size: 12 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4F81BD' }
    };
    headerRow.font = {
      bold: true,
      color: { argb: 'FFFFFF' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Adicionar dados
    movimentacoes.forEach(mov => {
      // Se a data estiver no formato dd/mm/yyyy, converter para objeto Date
      if (typeof mov.Data === 'string' && mov.Data.includes('/')) {
        const parts = mov.Data.split('/');
        if (parts.length === 3) {
          const [day, month, year] = parts;
          mov.Data = new Date(year, month - 1, day);
        }
      }
      
      const row = mainSheet.addRow(mov);
      
      // Aplicar cores diferentes para créditos e débitos
      if (mov.Tipo === 'Crédito') {
        row.getCell('Valor').font = { color: { argb: '008000' } }; // Verde
      } else if (mov.Tipo === 'Débito') {
        row.getCell('Valor').font = { color: { argb: 'FF0000' } }; // Vermelho
      }
    });
    
    // Calcular e adicionar o total
    const total = movimentacoes.reduce((acc, mov) => {
      const valor = typeof mov.Valor === 'string' 
        ? parseFloat(mov.Valor.replace(',', '.')) 
        : mov.Valor;
      return acc + (mov.Tipo === 'Crédito' ? valor : -valor);
    }, 0);
    
    // Adicionar linha de total com estilo
    const totalRow = mainSheet.addRow({ 
      Data: '', 
      Valor: total, 
      Tipo: '', 
      CategoriaDescricao: 'Total' 
    });
    totalRow.font = { bold: true };
    totalRow.getCell('CategoriaDescricao').alignment = { horizontal: 'right' };
    totalRow.getCell('Valor').font = { 
      bold: true, 
      color: { argb: total >= 0 ? '008000' : 'FF0000' } 
    };
    
    // Linha em branco após o total
    mainSheet.addRow({});
    
    // Adicionar filtros automáticos
    mainSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: movimentacoes.length, column: 4 }
    };
    
    // Congelar o painel na primeira linha
    mainSheet.views = [
      { state: 'frozen', xSplit: 0, ySplit: 1, activeCell: 'A2' }
    ];

    // ===== ABA DE DETALHAMENTO POR CATEGORIA =====
    const detailSheet = workbook.addWorksheet('Por Categoria', {
      properties: { tabColor: { argb: '4F81BD' } }
    });
    
    // Definir colunas
    detailSheet.columns = [
      { header: 'Categoria', key: 'Categoria', width: 22 },
      { header: 'Total', key: 'Total', width: 14, style: { numFmt: '"R$ "#,##0.00;[Red]"R$ -"#,##0.00' } },
      { header: 'Qtd. Movimentações', key: 'Quantidade', width: 18 }
    ];
    
    // Estilizar o cabeçalho
    const detailHeaderRow = detailSheet.getRow(1);
    detailHeaderRow.font = { bold: true, size: 12 };
    detailHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4F81BD' }
    };
    detailHeaderRow.font = {
      bold: true,
      color: { argb: 'FFFFFF' }
    };
    detailHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' };
    
    // Organizar os dados por categoria
    const categorias = {};
    movimentacoes.forEach(mov => {
      const categoriaKey = mov.CategoriaDescricao;
      
      if (!categorias[categoriaKey]) {
        categorias[categoriaKey] = {
          total: 0,
          quantidade: 0
        };
      }
      
      const valor = typeof mov.Valor === 'string' 
        ? parseFloat(mov.Valor.replace(',', '.')) 
        : mov.Valor;
        
      categorias[categoriaKey].total += (mov.Tipo === 'Crédito' ? valor : -valor);
      categorias[categoriaKey].quantidade += 1;
    });
    
    // Adicionar dados por categoria
    Object.entries(categorias).forEach(([categoria, dados]) => {
      const row = detailSheet.addRow({
        Categoria: categoria,
        Total: dados.total,
        Quantidade: dados.quantidade
      });
      
      // Aplicar cor de fonte com base no valor (positivo/negativo)
      row.getCell('Total').font = {
        color: { argb: dados.total >= 0 ? '008000' : 'FF0000' }
      };
    });
    
    // Adicionar linha de total
    const totalGeral = Object.values(categorias).reduce((acc, cat) => acc + cat.total, 0);
    const totalQuantidade = Object.values(categorias).reduce((acc, cat) => acc + cat.quantidade, 0);
    
    const totalCatRow = detailSheet.addRow({
      Categoria: 'TOTAL',
      Total: totalGeral,
      Quantidade: totalQuantidade
    });
    
    totalCatRow.font = { bold: true };
    totalCatRow.getCell('Total').font = {
      bold: true,
      color: { argb: totalGeral >= 0 ? '008000' : 'FF0000' }
    };
    
    // ===== ABA DE RESUMO =====
    const summarySheet = workbook.addWorksheet('Resumo', {
      properties: { tabColor: { argb: '9BBB59' } }
    });
    
    // Adicionar informações do período
    summarySheet.addRow(['RELATÓRIO DE MOVIMENTAÇÕES FINANCEIRAS']);
    summarySheet.addRow([`Período: ${periodo.dataInicio} a ${periodo.dataFim}`]);
    summarySheet.addRow([`Data de geração: ${new Date().toLocaleDateString('pt-BR')}`]);
    summarySheet.addRow([]);
    
    // Formatar cabeçalho
    summarySheet.getRow(1).font = { bold: true, size: 14 };
    summarySheet.getRow(2).font = { bold: true };
    summarySheet.getRow(3).font = { italic: true };
    
    // Resumo de valores
    summarySheet.addRow(['RESUMO DE VALORES']);
    summarySheet.getRow(5).font = { bold: true, size: 12 };
    
    const creditos = movimentacoes
      .filter(mov => mov.Tipo === 'Crédito')
      .reduce((acc, mov) => {
        const valor = typeof mov.Valor === 'string'
          ? parseFloat(mov.Valor.replace(',', '.'))
          : mov.Valor;
        return acc + valor;
      }, 0);
    
    const debitos = movimentacoes
      .filter(mov => mov.Tipo === 'Débito')
      .reduce((acc, mov) => {
        const valor = typeof mov.Valor === 'string'
          ? parseFloat(mov.Valor.replace(',', '.'))
          : mov.Valor;
        return acc + valor;
      }, 0);
    
    summarySheet.addRow(['Total de Créditos:', creditos]);
    summarySheet.addRow(['Total de Débitos:', debitos]);
    summarySheet.addRow(['Saldo do Período:', creditos - debitos]);
    
    // Formatar valores na planilha de resumo
    summarySheet.getCell('B6').numFmt = '"R$ "#,##0.00';
    summarySheet.getCell('B7').numFmt = '"R$ "#,##0.00';
    summarySheet.getCell('B8').numFmt = '"R$ "#,##0.00;[Red]"R$ -"#,##0.00';
    
    summarySheet.getCell('B6').font = { color: { argb: '008000' } };
    summarySheet.getCell('B7').font = { color: { argb: 'FF0000' } };
    summarySheet.getCell('B8').font = { 
      bold: true, 
      color: { argb: (creditos - debitos) >= 0 ? '008000' : 'FF0000' } 
    };
    
    // Ajustar larguras das colunas da planilha de resumo
    summarySheet.getColumn('A').width = 20;
    summarySheet.getColumn('B').width = 14;
    
    // Salvar o arquivo
    await workbook.xlsx.writeFile(filePath);
    
    if (!fs.existsSync(filePath)) {
      console.error('Arquivo não encontrado após tentativa de gravação!');
    }
    
    return filePath;
  } catch (error) {
    console.error('Erro ao gerar relatório Excel:', error);
    throw new Error('Ocorreu um erro ao gerar o relatório Excel.');
  }
}

module.exports = { generateXmlReport };