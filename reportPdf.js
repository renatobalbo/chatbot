const pdfkit = require('pdfkit');
const fs = require('fs');
const path = require('path');

async function generatePdfReport(movimentacoes, carteira, periodo, filePath) {
  return new Promise((resolve, reject) => {
    const doc = new pdfkit();
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    doc.fontSize(18).text(`Extrato da Carteira ${carteira}`, { align: 'center' });
    doc.fontSize(12).text(`Período: ${periodo.dataInicio} a ${periodo.dataFim}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).text('Data       | Valor         | Tipo     | Categoria', { underline: true });
    movimentacoes.forEach(mov => {
      doc.text(`${mov.Data} | ${mov.Valor} | ${mov.Tipo} | ${mov.CategoriaDescricao}`);
    });

    const saldo = movimentacoes.reduce((acc, mov) => acc + (mov.Tipo === 'Crédito' ? mov.Valor : -mov.Valor), 0);
    doc.moveDown().fontSize(12).text(`Saldo final do período: ${saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);

    // Criação de nova página para o resumo por categorias
    doc.addPage();
    doc.fontSize(18).text('Resumo por Categoria', { align: 'center' });
    doc.moveDown();

    const resumoCategorias = movimentacoes.reduce((acc, mov) => {
      acc[mov.CategoriaDescricao] = (acc[mov.CategoriaDescricao] || 0) + parseFloat(mov.Valor);
      return acc;
    }, {});

    doc.fontSize(10).text('Categoria       | Total', { underline: true });
    for (const [categoria, total] of Object.entries(resumoCategorias)) {
      doc.text(`${categoria} | ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
    }

    doc.end();

    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', reject);
  });
}

module.exports = { generatePdfReport };
