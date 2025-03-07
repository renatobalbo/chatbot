const fs = require('fs');
const ExcelJS = require('exceljs');

async function generateXmlReport(movimentacoes, carteira, periodo, filePath) {
  try {

    const reportsDir = './reports';
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir);
    }

    const workbook = new ExcelJS.Workbook();

    // Aba principal
    const mainSheet = workbook.addWorksheet('Extrato');
    mainSheet.columns = [
      { header: 'Data', key: 'Data', width: 15 },
      { header: 'Valor', key: 'Valor', width: 10 },
      { header: 'Tipo', key: 'Tipo', width: 10 },
      { header: 'Categoria', key: 'CategoriaDescricao', width: 20 }
    ];

    movimentacoes.forEach(mov => mainSheet.addRow(mov));

    const total = movimentacoes.reduce((acc, mov) => acc + parseFloat(mov.Valor), 0);
    mainSheet.addRow({ Data: '', Valor: total.toFixed(2), Tipo: '', CategoriaDescricao: 'Total' });

    // Aba de detalhamento por categoria
    const categorias = [...new Set(movimentacoes.map(mov => mov.CategoriaDescricao))];

    const detailSheet = workbook.addWorksheet('Por Categoria');
    detailSheet.columns = [
      { header: 'Categoria', key: 'Categoria', width: 20 },
      { header: 'Total', key: 'Total', width: 15 }
    ];

    categorias.forEach(categoria => {
      const totalCategoria = movimentacoes
        .filter(mov => mov.CategoriaDescricao === categoria)
        .reduce((acc, mov) => acc + parseFloat(mov.Valor), 0);

      detailSheet.addRow({ Categoria: categoria, Total: totalCategoria.toFixed(2) });
    });

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
