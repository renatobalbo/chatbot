// subscription.js - Módulo para gerenciamento de assinaturas
const { getConnection, sql } = require('./database');
const { registrarInteracao } = require('./interactionLog');
const axios = require('axios'); // Precisará instalar: npm install axios

// Configurações do Mercado Pago
const MERCADOPAGO_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MERCADOPAGO_API_BASE = 'https://api.mercadopago.com/v1';

// Definições dos planos
const PLANOS = {
    MENSAL: {
        id: 'plano_mensal', // ID configurado no Mercado Pago
        nome: 'Plano Mensal',
        descricao: 'Acesso PRO por 1 mês',
        valor: 19.90,
        intervalo: 'MONTH',
        intervalo_contagem: 1
    },
    ANUAL: {
        id: 'plano_anual', // ID configurado no Mercado Pago
        nome: 'Plano Anual',
        descricao: 'Acesso PRO por 12 meses com desconto',
        valor: 199.90,
        intervalo: 'MONTH',
        intervalo_contagem: 12
    }
};

/**
 * Iniciar processo de assinatura
 * @param {string} usuario - ID do usuário (telefone)
 * @param {string} planoId - ID do plano (MENSAL ou ANUAL)
 * @returns {Promise<{sucesso: boolean, link: string, mensagem: string}>}
 */
async function iniciarAssinatura(usuario, planoId) {
    try {
        // Obter informações do usuário
        const pool = await getConnection();
        const userResult = await pool.request()
            .input('Telefone', sql.NVarChar, usuario)
            .query('SELECT Nome FROM Usuarios WHERE Telefone = @Telefone');
        
        if (userResult.recordset.length === 0) {
            return {
                sucesso: false,
                mensagem: 'Usuário não encontrado'
            };
        }
        
        const nomeUsuario = userResult.recordset[0].Nome || 'Usuário';
        const plano = PLANOS[planoId];
        
        if (!plano) {
            return {
                sucesso: false,
                mensagem: 'Plano inválido'
            };
        }

        // Criar preferência de pagamento no Mercado Pago
        // Exemplo para Mercado Pago - ajustar conforme documentação atual
        const response = await axios.post(
            `${MERCADOPAGO_API_BASE}/preapproval_plan`,
            {
                reason: plano.nome,
                auto_recurring: {
                    frequency: plano.intervalo_contagem,
                    frequency_type: plano.intervalo,
                    transaction_amount: plano.valor,
                    currency_id: "BRL"
                },
                back_url: `https://seusite.com.br/assinatura/retorno?usuario=${encodeURIComponent(usuario)}`,
            },
            {
                headers: {
                    'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Registrar assinatura pendente no banco
        await pool.request()
            .input('Usuario', sql.NVarChar, usuario)
            .input('TipoAssinatura', sql.VarChar, planoId)
            .input('PlanoAssinatura', sql.VarChar, plano.nome)
            .input('IdAssinatura', sql.VarChar, response.data.id)
            .input('StatusPagamento', sql.VarChar, 'PENDENTE')
            .query(`
                UPDATE Usuarios 
                SET TipoAssinatura = @TipoAssinatura,
                    PlanoAssinatura = @PlanoAssinatura,
                    IdAssinatura = @IdAssinatura,
                    StatusPagamento = @StatusPagamento,
                    DataAtualizacao = GETDATE()
                WHERE Telefone = @Usuario
            `);
        
        // Log da operação
        await registrarInteracao(
            usuario,
            'ASSINATURA_INICIADA',
            planoId,
            `Assinatura ${plano.nome} iniciada`,
            'pagamento',
            'PENDENTE',
            {
                plano: planoId,
                valor: plano.valor,
                idAssinatura: response.data.id
            }
        );
        
        return {
            sucesso: true,
            link: response.data.init_point,
            mensagem: `Link para assinatura do ${plano.nome} gerado com sucesso`
        };
    } catch (error) {
        console.error('Erro ao iniciar assinatura:', error);
        
        // Log de erro
        await registrarInteracao(
            usuario,
            'ERRO_ASSINATURA',
            planoId,
            'Erro ao iniciar assinatura',
            'pagamento',
            'ERRO',
            {
                plano: planoId,
                erro: error.message
            }
        );
        
        return {
            sucesso: false,
            mensagem: 'Erro ao iniciar assinatura. Tente novamente mais tarde.'
        };
    }
}

/**
 * Verificar status da assinatura
 * @param {string} usuario - ID do usuário (telefone)
 * @returns {Promise<{ativo: boolean, plano: string, dataExpiracao: Date}>}
 */
async function verificarAssinatura(usuario) {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, usuario)
            .query(`
                SELECT 
                    UsuarioPro, 
                    TipoAssinatura, 
                    DataInicioAssinatura, 
                    DataFimAssinatura, 
                    IdAssinatura, 
                    StatusPagamento 
                FROM Usuarios 
                WHERE Telefone = @Usuario
            `);
        
        if (result.recordset.length === 0) {
            return { ativo: false };
        }
        
        const userData = result.recordset[0];
        
        // Se já temos o status armazenado e assinatura ativa
        if (userData.UsuarioPro && userData.StatusPagamento === 'ATIVO' && 
            userData.DataFimAssinatura && new Date(userData.DataFimAssinatura) > new Date()) {
            return {
                ativo: true,
                plano: userData.TipoAssinatura,
                dataExpiracao: userData.DataFimAssinatura
            };
        }
        
        // Se temos um ID de assinatura, verificar status atual na API
        if (userData.IdAssinatura) {
            // Exemplo para Mercado Pago - ajustar conforme documentação
            const response = await axios.get(
                `${MERCADOPAGO_API_BASE}/preapproval/${userData.IdAssinatura}`,
                {
                    headers: {
                        'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`
                    }
                }
            );
            
            const assinaturaAtiva = response.data.status === 'authorized';
            
            // Atualizar o status no banco
            await pool.request()
                .input('Usuario', sql.NVarChar, usuario)
                .input('StatusPagamento', sql.VarChar, assinaturaAtiva ? 'ATIVO' : 'INATIVO')
                .input('UsuarioPro', sql.Bit, assinaturaAtiva ? 1 : 0)
                .input('DataInicioAssinatura', sql.DateTime, assinaturaAtiva ? new Date() : null)
                .input('DataFimAssinatura', sql.DateTime, assinaturaAtiva ? calcularDataExpiracao(userData.TipoAssinatura) : null)
                .query(`
                    UPDATE Usuarios 
                    SET StatusPagamento = @StatusPagamento,
                        UsuarioPro = @UsuarioPro,
                        DataInicioAssinatura = COALESCE(@DataInicioAssinatura, DataInicioAssinatura),
                        DataFimAssinatura = @DataFimAssinatura,
                        DataAtualizacao = GETDATE()
                    WHERE Telefone = @Usuario
                `);
            
            return {
                ativo: assinaturaAtiva,
                plano: userData.TipoAssinatura,
                dataExpiracao: assinaturaAtiva ? calcularDataExpiracao(userData.TipoAssinatura) : null
            };
        }
        
        return { ativo: false };
    } catch (error) {
        console.error('Erro ao verificar assinatura:', error);
        
        // Em caso de erro, verificamos localmente
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, usuario)
            .query('SELECT UsuarioPro FROM Usuarios WHERE Telefone = @Usuario');
        
        if (result.recordset.length > 0) {
            return { 
                ativo: result.recordset[0].UsuarioPro === true,
                plano: 'Não foi possível verificar detalhes'
            };
        }
        
        return { ativo: false };
    }
}

/**
 * Cancelar assinatura
 * @param {string} usuario - ID do usuário (telefone)
 * @returns {Promise<{sucesso: boolean, mensagem: string}>}
 */
async function cancelarAssinatura(usuario) {
    try {
        // Obter ID da assinatura
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, usuario)
            .query('SELECT IdAssinatura FROM Usuarios WHERE Telefone = @Usuario');
        
        if (result.recordset.length === 0 || !result.recordset[0].IdAssinatura) {
            return { 
                sucesso: false, 
                mensagem: 'Nenhuma assinatura encontrada para este usuário' 
            };
        }
        
        const idAssinatura = result.recordset[0].IdAssinatura;
        
        // Cancelar na plataforma de pagamento
        // Exemplo para Mercado Pago - ajustar conforme documentação
        await axios.put(
            `${MERCADOPAGO_API_BASE}/preapproval/${idAssinatura}`,
            { status: 'cancelled' },
            {
                headers: {
                    'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        // Atualizar status no banco
        await pool.request()
            .input('Usuario', sql.NVarChar, usuario)
            .query(`
                UPDATE Usuarios 
                SET StatusPagamento = 'CANCELADO',
                    UsuarioPro = 0,
                    DataAtualizacao = GETDATE()
                WHERE Telefone = @Usuario
            `);
        
        // Log da operação
        await registrarInteracao(
            usuario,
            'ASSINATURA_CANCELADA',
            idAssinatura,
            'Assinatura cancelada com sucesso',
            'pagamento',
            'CANCELADO',
            { idAssinatura }
        );
        
        return {
            sucesso: true,
            mensagem: 'Assinatura cancelada com sucesso'
        };
    } catch (error) {
        console.error('Erro ao cancelar assinatura:', error);
        
        // Log de erro
        await registrarInteracao(
            usuario,
            'ERRO_CANCELAMENTO',
            usuario,
            'Erro ao cancelar assinatura',
            'pagamento',
            'ERRO',
            { erro: error.message }
        );
        
        return {
            sucesso: false,
            mensagem: 'Erro ao cancelar assinatura. Tente novamente mais tarde.'
        };
    }
}

/**
 * Processar webhook de notificação de pagamento
 * @param {Object} notificacao - Dados da notificação
 * @returns {Promise<boolean>}
 */
async function processarNotificacaoPagamento(notificacao) {
    try {
        // Extrair informações relevantes da notificação
        // Isso varia dependendo da plataforma de pagamento
        // Exemplo para Mercado Pago
        const recursoId = notificacao.resource.split('/').pop();
        const tipoRecurso = notificacao.resource.split('/')[1];
        
        if (tipoRecurso !== 'preapproval') {
            console.log('Notificação ignorada: não é uma assinatura');
            return true;
        }
        
        // Obter detalhes da assinatura
        const response = await axios.get(
            `${MERCADOPAGO_API_BASE}/preapproval/${recursoId}`,
            {
                headers: {
                    'Authorization': `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`
                }
            }
        );
        
        // Dados da assinatura
        const assinatura = response.data;
        const statusAssinatura = assinatura.status;
        const telefoneUsuario = assinatura.external_reference; // Precisa definir este campo ao criar assinatura
        
        // Atualizar status da assinatura no banco
        const pool = await getConnection();
        await pool.request()
            .input('Usuario', sql.NVarChar, telefoneUsuario)
            .input('StatusPagamento', sql.VarChar, statusMappingToInternal(statusAssinatura))
            .input('UsuarioPro', sql.Bit, statusAssinatura === 'authorized' ? 1 : 0)
            .input('DataInicioAssinatura', sql.DateTime, statusAssinatura === 'authorized' ? new Date() : null)
            .input('DataFimAssinatura', sql.DateTime, statusAssinatura === 'authorized' ? 
                calcularDataExpiracao(assinatura.auto_recurring.frequency, assinatura.auto_recurring.frequency_type) : null)
            .query(`
                UPDATE Usuarios 
                SET StatusPagamento = @StatusPagamento,
                    UsuarioPro = @UsuarioPro,
                    DataInicioAssinatura = COALESCE(@DataInicioAssinatura, DataInicioAssinatura),
                    DataFimAssinatura = @DataFimAssinatura,
                    DataAtualizacao = GETDATE()
                WHERE Telefone = @Usuario
            `);
        
        // Log da operação
        await registrarInteracao(
            telefoneUsuario,
            'NOTIFICACAO_PAGAMENTO',
            recursoId,
            `Status atualizado para ${statusAssinatura}`,
            'pagamento',
            'PROCESSADO',
            {
                idAssinatura: recursoId,
                status: statusAssinatura
            }
        );
        
        return true;
    } catch (error) {
        console.error('Erro ao processar notificação de pagamento:', error);
        return false;
    }
}

// Funções auxiliares

/**
 * Calcular data de expiração com base no plano
 * @param {string} tipoPlano - Identificador do plano
 * @returns {Date} Data de expiração
 */
function calcularDataExpiracao(tipoPlano) {
    const hoje = new Date();
    const plano = PLANOS[tipoPlano];
    
    if (!plano) return hoje; // Proteção
    
    if (plano.intervalo === 'MONTH') {
        hoje.setMonth(hoje.getMonth() + plano.intervalo_contagem);
    } else if (plano.intervalo === 'YEAR') {
        hoje.setFullYear(hoje.getFullYear() + plano.intervalo_contagem);
    } else if (plano.intervalo === 'DAY') {
        hoje.setDate(hoje.getDate() + plano.intervalo_contagem);
    }
    
    return hoje;
}

/**
 * Converter status da plataforma para status interno
 * @param {string} statusExterno - Status da plataforma de pagamento
 * @returns {string} Status interno
 */
function statusMappingToInternal(statusExterno) {
    // Para Mercado Pago - ajustar conforme documentação
    const mapping = {
        'authorized': 'ATIVO',
        'paused': 'PAUSADO',
        'cancelled': 'CANCELADO',
        'pending': 'PENDENTE'
    };
    
    return mapping[statusExterno] || 'DESCONHECIDO';
}

module.exports = {
    iniciarAssinatura,
    verificarAssinatura,
    cancelarAssinatura,
    processarNotificacaoPagamento,
    PLANOS
};