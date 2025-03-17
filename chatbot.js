require('dotenv').config();
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');
const { MessageMedia } = require('whatsapp-web.js');

const { registrarInteracao } = require('./interactionLog');
const { generateStatementReport } = require('./reports');
const userManager = require('./userManagement');
const { isAdminUser } = require('./utils');
const { MenuHandler } = require('./menus');
const { TransactionHandler } = require('./transactions');

// Inicializar o cliente WhatsApp
const client = new Client();

// Estado do usuário
const userState = {};

// Chamada do QRCode e conexão com o Whatsapp
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

// Tratamento de mensagens
client.on('message', async msg => {
    const user = msg.from;
    const message = msg.body.trim();

    // Log de recebimento de cada mensagem
    await registrarInteracao(
        user,
        'MENSAGEM_RECEBIDA',
        message,
        null,
        userState[user]?.etapa || 'inicio',
        'RECEBIDO',
        {}
    );

    // Inicializar estado do usuário se não existir
    if (!userState[user]) {
        userState[user] = {};
    }

    // Registrar ou atualizar usuário no banco de dados
    try {
        if (!await userManager.isUserRegistered(user)) {
            await userManager.registerUser(user);
        } else {
            await userManager.updateUserActivity(user);
        }
    } catch (error) {
        console.error('Erro ao gerenciar registro do usuário:', error);
    }

    // Inicializar handlers
    const menuHandler = new MenuHandler(client, userState);
    const transactionHandler = new TransactionHandler(client, userState);

    // Processamento de comandos e menus
    try {
        // 1. Menu Principal
        if (await menuHandler.handleMainMenu(user, message)) return;
        
        // 2. Seleção no Menu Principal
        if (await menuHandler.handleMainMenuSelection(user, message)) return;
        
        // 3. Menu de Carteiras
        if (await menuHandler.handleCarteiraMenu(user, message)) return;
        
        // 4. Menu de Categorias
        if (await menuHandler.handleCategoriaMenu(user, message)) return;
        
        // 5. Menu de Ajuda
        if (await menuHandler.handleHelpMenu(user, message)) return;
        
        // 6. Menu de Assinatura
        if (await menuHandler.handleSubscriptionMenu(user, message)) return;
        if (await menuHandler.handleReportMenu(user, message)) return;
        
        // 7. Menu de Tutoriais
        if (await menuHandler.handleTutorialMenu(user, message)) return;
        
        // 8. Processamento de tutoriais
        if (userState[user]?.etapa === 'tutorial_entrada' && userState[user]?.aguardandoComando !== true) {
            await menuHandler.processarTutorialEntrada(user, message);
            return;
        }
        
        // 9. Escolha após finalização de tutorial
        if (await menuHandler.handleTutorialFinished(user, message)) return;
        
        // 10. Confirmação de cancelamento de assinatura
        if (await menuHandler.handleConfirmCancelSubscription(user, message)) return;
        
        // 11. Seleção de plano
        if (await menuHandler.handlePlanSelection(user, message)) return;

        // 12. Iniciar transação (entrada/saída)
        if (await transactionHandler.startTransaction(user, message)) return;
        
        // 13. Etapas da transação
        if (await transactionHandler.handleValorStep(user, message)) return;
        if (await transactionHandler.handleCarteiraStep(user, message)) return;
        if (await transactionHandler.handleCategoriaStep(user, message)) return;
        if (await transactionHandler.handleConfirmacaoStep(user, message)) return;
        
        // 14. Consulta de Saldo
        if (await transactionHandler.handleSaldoCommand(user, message)) return;
        
        // 15. Seleção de carteira para saldo
        if (await transactionHandler.handleSaldoCarteiraSelection(user, message)) return;
        
        // 16. Cancelar operação
        if (await transactionHandler.handleCancelar(user, message)) return;

        // 17. Atalhos para ações diretas
        // Atalho para listar carteiras
        if (message.toLowerCase() === 'listar carteiras') {
            const { listarCarteiras } = require('./wallets');
            await listarCarteiras(client, user);
            return;
        }
        
        // Atalho para listar categorias
        if (message.toLowerCase() === 'listar categorias') {
            const { listarCategorias } = require('./categories');
            await listarCategorias(client, user);
            return;
        }
        
        // Atalho para cadastrar carteira
        if (message.toLowerCase() === 'cadastrar carteira') {
            userState[user] = { etapa: 'descricao_carteira' };
            await client.sendMessage(user, 'Qual descrição da carteira?');
            return;
        }
        
        // Atalho para cadastrar categoria
        if (message.toLowerCase() === 'cadastrar categoria') {
            userState[user] = { etapa: 'descricao_categoria' };
            await client.sendMessage(user, 'Qual descrição da categoria?');
            return;
        }
        
        // Atalho para excluir categoria
        if (message.toLowerCase() === 'excluir categoria') {
            const { listCategorias } = require('./categories');
            const categorias = await listCategorias(user);
            
            if (!categorias || categorias.length === 0) {
                await client.sendMessage(user, 'Não há categorias cadastradas para excluir.');
                return;
            }
            
            const categoriasUsuario = categorias.filter(cat => cat.Usuario?.trim().toLowerCase() === user.trim().toLowerCase());
            
            if (categoriasUsuario.length === 0) {
                await client.sendMessage(user, 'Não há categorias próprias cadastradas para excluir.');
                return;
            }
            
            let listaFormatada = 'Escolha a categoria que deseja excluir, informando o código correspondente:\n';
            categoriasUsuario.forEach(cat => {
                listaFormatada += `${cat.Codigo} - ${cat.Descricao}\n`;
            });
            
            userState[user] = { etapa: 'selecionar_categoria_exclusao', categorias: categoriasUsuario };
            await client.sendMessage(user, listaFormatada);
            return;
        }
        
        // Atalhos para relatórios
        if (['relatorio pdf', 'pdf'].includes(message.toLowerCase())) {
            await registrarInteracao(
                user,
                'ATALHO_RELATORIO',
                message,
                'Iniciando processo de relatório PDF via atalho',
                'atalho_pdf',
                'INICIADO',
                { format: 'pdf' }
            );
            
            if (userState[user]?.etapa?.startsWith('relatorio_')) {
                await client.sendMessage(user, 'Você já tem um processo de relatório em andamento. Por favor, conclua-o ou digite "cancelar" para interromper.');
                return;
            }
            
            generateStatementReport(client, msg, 'pdf');
            return;
        }
        
        if (['relatorio xml', 'xml', 'relatorio excel', 'excel'].includes(message.toLowerCase())) {
            await registrarInteracao(
                user,
                'ATALHO_RELATORIO',
                message,
                'Iniciando processo de relatório Excel via atalho',
                'atalho_excel',
                'INICIADO',
                { format: 'xml' }
            );
            
            if (userState[user]?.etapa?.startsWith('relatorio_')) {
                await client.sendMessage(user, 'Você já tem um processo de relatório em andamento. Por favor, conclua-o ou digite "cancelar" para interromper.');
                return;
            }
            
            generateStatementReport(client, msg, 'xml');
            return;
        }
        
        // Atalho para status de assinatura
        if (message.toLowerCase() === 'status' || message.toLowerCase() === 'minha assinatura') {
            const { verificarAssinatura } = require('./subscription');
            try {
                const status = await verificarAssinatura(user);
                
                if (status.ativo) {
                    const dataExpiracao = new Date(status.dataExpiracao);
                    const dataFormatada = dataExpiracao.toLocaleDateString('pt-BR');
                    
                    await client.sendMessage(user, 
                        `✅ *Assinatura Ativa*\n` +
                        `🔹 Plano: ${status.plano}\n` +
                        `🔹 Válido até: ${dataFormatada}\n\n` +
                        `Para cancelar sua assinatura, digite "cancelar assinatura"`
                    );
                } else {
                    await client.sendMessage(user, 
                        `❌ *Você não possui uma assinatura ativa*\n\n` +
                        `Para conhecer nossos planos, digite "planos"`
                    );
                }
            } catch (error) {
                console.error('Erro ao verificar status:', error);
                await client.sendMessage(user, 'Ocorreu um erro ao verificar o status da sua assinatura. Por favor, tente novamente mais tarde.');
            }
            return;
        }
        
        // Atalho para planos
        if (message.toLowerCase() === 'planos' || message.toLowerCase() === 'assinatura') {
            const result = await menuHandler.exibirPlanos(user);
            if (result) {
                userState[user] = result;
            }
            return;
        }
        
        // Atalho para cancelar assinatura
        if (message.toLowerCase() === 'cancelar assinatura') {
            userState[user] = { etapa: 'confirmar_cancelamento' };
            await client.sendMessage(user, 
                `⚠️ *Tem certeza que deseja cancelar sua assinatura?*\n\n` +
                `Ao cancelar, você continuará com acesso até o final do período já pago, mas não será renovada automaticamente.\n\n` +
                `Digite "confirmar" para prosseguir com o cancelamento ou "voltar" para desistir.`
            );
            return;
        }

        // 18. Menu administrativo (acessível apenas para administradores)
        if (message.toLowerCase() === 'admin menu' && await isAdminUser(user)) {
            await client.sendMessage(user, 'Menu de Administração:\n1 - Listar Usuários\n2 - Tornar Usuário PRO\n3 - Desativar Usuário\n4 - Reativar Usuário');
            userState[user] = { etapa: 'admin_menu' };
            return;
        }
        
        // 19. Processamento de comandos administrativos
        if (userState[user]?.etapa === 'admin_menu' && await isAdminUser(user)) {
            await handleAdminCommands(user, message);
            return;
        }
        
        // Processar comandos de administração de usuários
        if (userState[user]?.etapa === 'set_user_pro' && await isAdminUser(user)) {
            const targetUser = message.trim();
            try {
                await userManager.updateUserProStatus(targetUser, true);
                await client.sendMessage(user, `Usuário ${targetUser} agora é PRO!`);
            } catch (error) {
                console.error('Erro ao atualizar status PRO:', error);
                await client.sendMessage(user, 'Ocorreu um erro ao atualizar o status do usuário.');
            }
            delete userState[user];
            return;
        }
        
        if (userState[user]?.etapa === 'deactivate_user' && await isAdminUser(user)) {
            const targetUser = message.trim();
            try {
                await userManager.deactivateUser(targetUser);
                await client.sendMessage(user, `Usuário ${targetUser} foi desativado.`);
            } catch (error) {
                console.error('Erro ao desativar usuário:', error);
                await client.sendMessage(user, 'Ocorreu um erro ao desativar o usuário.');
            }
            delete userState[user];
            return;
        }
        
        if (userState[user]?.etapa === 'reactivate_user' && await isAdminUser(user)) {
            const targetUser = message.trim();
            try {
                await userManager.reactivateUser(targetUser);
                await client.sendMessage(user, `Usuário ${targetUser} foi reativado.`);
            } catch (error) {
                console.error('Erro ao reativar usuário:', error);
                await client.sendMessage(user, 'Ocorreu um erro ao reativar o usuário.');
            }
            delete userState[user];
            return;
        }

        // 20. Se chegou aqui e não encontrou nenhum comando, exibir menu de ajuda para novos usuários
        if (!userState[user] || Object.keys(userState[user]).length === 0) {
            // Verificamos se o usuário é novo para evitar exibir mensagens indesejadas para usuários existentes
            const userInfo = await userManager.getUserInfo(user);
            if (userInfo && new Date().getTime() - new Date(userInfo.DataCadastro).getTime() < 24 * 60 * 60 * 1000) {
                // Usuário novo (menos de 24h), exibir mensagem de boas-vindas
                await client.sendMessage(user, 
                    `👋 Olá! Bem-vindo ao FinançasBot!\n\n` +
                    `Para começar, experimente estes comandos:\n` +
                    `📋 "menu" - Acessar o menu principal\n` +
                    `💰 "entrada" - Registrar receita\n` +
                    `💸 "saída" - Registrar despesa\n` +
                    `💼 "saldo" - Consultar seu saldo\n` +
                    `❓ "ajuda" - Ver todas as opções\n\n` +
                    `Digite "menu" para começar!`
                );
            }
        }
        
    } catch (error) {
        console.error('Erro ao processar mensagem:', error);
        
        // Log do erro
        await registrarInteracao(
            user,
            'ERRO_PROCESSAMENTO',
            message,
            `Erro: ${error.message}`,
            userState[user]?.etapa || 'desconhecida',
            'ERRO',
            { erro: error.message, stack: error.stack }
        );
    }
});

// Função para listar usuários (apenas para admins)
async function listUsers(adminUser) {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .query(`
                SELECT TOP 20 Telefone, Nome, 
                    CASE WHEN UsuarioPro = 1 THEN 'Sim' ELSE 'Não' END AS Pro,
                    CASE WHEN Ativo = 1 THEN 'Sim' ELSE 'Não' END AS Ativo,
                    FORMAT(UltimaAtividade, 'dd/MM/yyyy HH:mm') AS UltimaAtiv
                FROM Usuarios
                ORDER BY UltimaAtividade DESC
            `);
        
        if (result.recordset.length === 0) {
            await client.sendMessage(adminUser, 'Nenhum usuário registrado.');
            return;
        }
        
        let message = 'Últimos 20 usuários ativos:\n\n';
        result.recordset.forEach(user => {
            message += `📱 ${user.Telefone}\n`;
            message += `👤 ${user.Nome || 'Nome não registrado'}\n`;
            message += `✅ PRO: ${user.Pro} | Ativo: ${user.Ativo}\n`;
            message += `⏱️ Última atividade: ${user.UltimaAtiv}\n\n`;
        });
        
        await client.sendMessage(adminUser, message);
    } catch (error) {
        console.error('Erro ao listar usuários:', error);
        await client.sendMessage(adminUser, 'Ocorreu um erro ao listar os usuários.');
    }
}

// Função para processar comandos administrativos
async function handleAdminCommands(user, message) {
    switch (message) {
        case '1': // Listar Usuários
            await listUsers(user);
            break;
            
        case '2': // Tornar Usuário PRO
            userState[user] = { etapa: 'set_user_pro' };
            await client.sendMessage(user, 'Digite o número do telefone do usuário que deseja tornar PRO (formato: 55119999999@c.us):');
            break;
            
        case '3': // Desativar Usuário
            userState[user] = { etapa: 'deactivate_user' };
            await client.sendMessage(user, 'Digite o número do telefone do usuário que deseja desativar (formato: 55119999999@c.us):');
            break;
            
        case '4': // Reativar Usuário
            userState[user] = { etapa: 'reactivate_user' };
            await client.sendMessage(user, 'Digite o número do telefone do usuário que deseja reativar (formato: 55119999999@c.us):');
            break;
            
        default:
            await client.sendMessage(user, 'Opção inválida. Por favor, digite um número entre 1 e 4.');
    }
}

// Inicialização do cliente
client.initialize();