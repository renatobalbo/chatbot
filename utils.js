// utils.js - Funções utilitárias compartilhadas
const { registrarInteracao } = require('./interactionLog');

/**
 * Função para aguardar resposta do usuário
 * @param {Object} client - Instância do cliente WhatsApp
 * @param {string} user - ID do usuário
 * @param {string} question - Pergunta a ser enviada
 * @returns {Promise<Object>} - Promessa que resolve com a resposta do usuário
 */
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

/**
 * Verifica se um usuário é administrador
 * @param {string} user - ID do usuário
 * @returns {Promise<boolean>} - Promessa que resolve com true se o usuário for admin
 */
async function isAdminUser(user) {
    // Lista de usuários administradores
    const adminUsers = ['554396697747@c.us']; // Alterar para os números reais
    return adminUsers.includes(user);
}

/**
 * Formata moeda em formato brasileiro
 * @param {number} valor - Valor a ser formatado
 * @returns {string} - Valor formatado
 */
function formatCurrency(valor) {
    if (valor === undefined || valor === null) return 'R$ 0,00';
    
    // Se for string, limpar e converter
    if (typeof valor === 'string') {
        valor = parseFloat(valor.replace(/[^\d,-]/g, '').replace(',', '.'));
    }
    
    if (isNaN(valor)) return 'R$ 0,00';
    
    // Formatar com apenas 2 casas decimais para garantir compatibilidade
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor);
}

/**
 * Formata data para o formato brasileiro DD/MM/YYYY
 * @param {string|Date} date - Data a ser formatada
 * @returns {string} - Data formatada
 */
function formatDate(date) {
    if (!date) return '';
    
    // Verifica se a data já está no formato DD/MM/YYYY
    if (typeof date === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        return date;
    }
    
    try {
        const dateObj = date instanceof Date ? date : new Date(date);
        if (isNaN(dateObj.getTime())) return String(date); // Data inválida
        return dateObj.toLocaleDateString('pt-BR');
    } catch (e) {
        return String(date); // Retorna a string original em caso de erro
    }
}

/**
 * Calcula datas para períodos predefinidos
 * @param {string} opcao - Opção de período (1: 15 dias, 2: 30 dias, 3: 90 dias)
 * @returns {Object} - Objeto com dataInicio e dataFim
 */
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
        dataInicio: formatDate(dataInicio),
        dataFim: formatDate(hoje)
    };
}

/**
 * Função para converter valor de string para número
 * @param {string} valorStr - Valor como string (ex: "10,50")
 * @returns {number} - Valor como número
 */
function parseValor(valorStr) {
    if (!valorStr) return 0;
    return parseFloat(valorStr.replace(',', '.'));
}

/**
 * Gera um nome de arquivo para relatórios
 * @param {string} user - ID do usuário
 * @param {string} format - Formato (pdf, xml, etc)
 * @returns {string} - Nome do arquivo
 */
function buildReportFileName(user, format) {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    return `Extrato_${user.replace(/[^a-zA-Z0-9]/g, '_')}_${date}_${time}.${format}`;
}

module.exports = {
    getUserResponse,
    isAdminUser,
    formatCurrency,
    formatDate,
    calcularPeriodoPredefinido,
    parseValor,
    buildReportFileName
};