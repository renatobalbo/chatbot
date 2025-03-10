const { getConnection, sql } = require('./database');

async function limparLogsAntigos(diasRetencao = 30) {
    try {
        console.log(`Iniciando limpeza de logs com mais de ${diasRetencao} dias...`);
        const pool = await getConnection();
        const result = await pool.request()
            .input('diasRetencao', sql.Int, diasRetencao)
            .query(`DELETE FROM Interacoes 
                   WHERE DataHora < DATEADD(day, -@diasRetencao, GETDATE())`);
        
        console.log(`Limpeza concluída. ${result.rowsAffected[0]} registros removidos.`);
        process.exit(0);
    } catch (error) {
        console.error('Erro ao limpar logs antigos:', error);
        process.exit(1);
    }
}

// Execute a limpeza quando o script for chamado
limparLogsAntigos(process.argv[2] || 30);