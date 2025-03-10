// interactionLog.js
const { getConnection, sql } = require('./database');

/**
 * Registra uma interação do usuário com o chatbot
 * @param {string} usuario - ID do usuário (número de telefone)
 * @param {string} tipoInteracao - Tipo da interação (ENTRADA, SAIDA, CONSULTA, etc)
 * @param {string} mensagemUsuario - Mensagem recebida do usuário
 * @param {string} mensagemBot - Resposta enviada pelo bot
 * @param {string} contextoEtapa - Etapa do fluxo (valor, carteira, confirmacao)
 * @param {string} resultado - Resultado (SUCESSO, ERRO, CANCELADO)
 * @param {object} dadosRelevantes - Objeto com dados extras da operação
 */
async function registrarInteracao(usuario, tipoInteracao, mensagemUsuario, mensagemBot, contextoEtapa, resultado, dadosRelevantes = {}) {
    try {
        const pool = await getConnection();
        
        // Limitar tamanho das mensagens para evitar problemas com espaço
        const msgUsuarioLimitada = mensagemUsuario?.substring(0, 1000) || null;
        const msgBotLimitada = mensagemBot?.substring(0, 1000) || null;
        
        // Converter objeto de dados relevantes para JSON
        const dadosJSON = dadosRelevantes ? JSON.stringify(dadosRelevantes) : null;
        
        // Calcular duração se não fornecida (para compatibilidade)
        let duracao = dadosRelevantes.duracao;
        if (duracao === undefined) {
            duracao = null; // Não calcular se não tiver marcos de tempo iniciais
        }
        
        await pool.request()
            .input('Usuario', sql.NVarChar, usuario)
            .input('TipoInteracao', sql.VarChar, tipoInteracao)
            .input('MensagemUsuario', sql.NVarChar, msgUsuarioLimitada)
            .input('MensagemBot', sql.NVarChar, msgBotLimitada)
            .input('ContextoEtapa', sql.VarChar, contextoEtapa || null)
            .input('Resultado', sql.VarChar, resultado || null)
            .input('DadosRelevantes', sql.NVarChar, dadosJSON)
            .input('DuracaoProcessamento', sql.Int, duracao)
            .query(`
                INSERT INTO Interacoes (Usuario, DataHora, TipoInteracao, MensagemUsuario, 
                    MensagemBot, ContextoEtapa, Resultado, DadosRelevantes, DuracaoProcessamento)
                VALUES (@Usuario, GETDATE(), @TipoInteracao, @MensagemUsuario, 
                    @MensagemBot, @ContextoEtapa, @Resultado, @DadosRelevantes, @DuracaoProcessamento)
            `);
    } catch (error) {
        console.error('Erro ao registrar interação:', error);
        // Não interrompe o fluxo principal por causa de um erro no log
    }
}

module.exports = { registrarInteracao };