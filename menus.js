// menus.js - Gerenciamento de menus do chatbot
const { registrarInteracao } = require('./interactionLog');
const { getCarteiras, saveCarteiraToDB, consultarSaldo, listarCarteiras } = require('./wallets');
const { getCategorias, saveCategoriaToDB, checkCategoriaExists, checkCategoriaInUse, deleteCategoriaFromDB, listCategorias, listarCategorias } = require('./categories');
const { verificarAssinatura, iniciarAssinatura, cancelarAssinatura, PLANOS } = require('./subscription');
const { getUserResponse } = require('./utils');

// Gerenciador central de menus
class MenuHandler {
    constructor(client, userState) {
        this.client = client;
        this.userState = userState;
    }

    // Menu Principal
    async handleMainMenu(user, message) {
        if (message.toLowerCase() !== 'menu') return false;

        this.userState[user] = { etapa: 'menu' };
        const menuMsg = 'Menu Principal:\n1 - Entradas\n2 - Saídas\n3 - Ver Saldo\n4 - Carteiras\n5 - Categorias\n6 - Relatórios\n7 - Manutenções\n8 - Ajuda\n9 - Assinatura';
        await this.client.sendMessage(user, menuMsg);
        
        // Log do menu
        await registrarInteracao(
            user,
            'MENU_PRINCIPAL',
            message,
            menuMsg,
            'menu',
            'EXIBIDO',
            {}
        );
        
        return true;
    }

    // Handler para seleção no menu principal
    async handleMainMenuSelection(user, message) {
        if (this.userState[user]?.etapa !== 'menu' || !['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(message)) {
            return false;
        }

        switch (message) {
            case '1': // Entradas
                this.userState[user] = { etapa: 'valor', tipo: 'Crédito' };
                await this.client.sendMessage(user, 'Informe o valor da entrada:');
                
                await registrarInteracao(
                    user,
                    'MENU_ENTRADA',
                    message,
                    'Menu de Entrada acessado',
                    'menu_entrada',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '2': // Saídas
                this.userState[user] = { etapa: 'valor', tipo: 'Débito' };
                await this.client.sendMessage(user, 'Informe o valor da saída:');
                
                await registrarInteracao(
                    user,
                    'MENU_SAIDA',
                    message,
                    'Menu de Saida acessado',
                    'menu_saida',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '3': // Ver Saldo
                const result = await consultarSaldo(this.client, user);
                if (result && result.etapa) {
                    this.userState[user].etapa = result.etapa;
                }

                await registrarInteracao(
                    user,
                    'MENU_SALDO',
                    message,
                    'Menu de Saldo acessado',
                    'menu_saldo',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '4': // Carteiras
                this.userState[user] = { etapa: 'menu_carteiras' };
                await this.client.sendMessage(user, 'Menu Carteiras:\n1 - Listar Carteiras\n2 - Cadastrar Carteira');
                
                await registrarInteracao(
                    user,
                    'MENU_CARTEIRAS',
                    message,
                    'Menu de Carteiras acessado',
                    'menu_carteiras',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '5': // Categorias
                this.userState[user] = { etapa: 'menu_categorias' };
                await this.client.sendMessage(user, 'Menu Categorias:\n1 - Listar Categorias\n2 - Cadastrar Categoria\n3 - Excluir Categoria');
                
                await registrarInteracao(
                    user,
                    'MENU_CATEGORIAS',
                    message,
                    'Menu de Categorias acessado',
                    'menu_categorias',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '6': // Relatórios
                this.userState[user] = { etapa: 'menu_relatorios' };
                await this.client.sendMessage(user, 'Menu Relatórios:\n1 - Extrato em PDF\n2 - Extrato em Excel');

                await registrarInteracao(
                    user,
                    'MENU_RELATORIOS',
                    message,
                    'Menu de Relatorios acessado',
                    'menu_relatorios',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '7': // Manutenções
                this.userState[user] = { etapa: 'menu_manutencoes' };
                await this.client.sendMessage(user, 'A opção de Manutenções será implementada em breve.');

                await registrarInteracao(
                    user,
                    'MENU_MANUTENCOES',
                    message,
                    'Menu de Manutencoes acessado',
                    'menu_manutencoes',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '8': // Ajuda
                this.userState[user] = { etapa: 'menu_ajuda' };
                await this.client.sendMessage(user, 'Menu de Ajuda:\n1 - Guia Rápido\n2 - Gestão Financeira\n3 - Consultas e Saldo\n4 - Relatórios e Análises\n5 - Personalização\n6 - Dicas Financeiras\n7 - FAQ\n8 - Comandos de Voz\n9 - Tutoriais Interativos');
                
                await registrarInteracao(
                    user,
                    'MENU_AJUDA',
                    message,
                    'Menu de Ajuda acessado',
                    'menu_ajuda',
                    'EXIBIDO',
                    {}
                );
                break;
                
            case '9': // Assinatura
                this.userState[user] = { etapa: 'menu_assinatura' };
                await this.client.sendMessage(user, 'Menu Assinatura:\n1 - Ver Planos\n2 - Status da Minha Assinatura\n3 - Cancelar Assinatura');
                
                await registrarInteracao(
                    user,
                    'MENU_ASSINATURA',
                    message,
                    'Menu de Assinatura acessado',
                    'menu_assinatura',
                    'EXIBIDO',
                    {}
                );
                break;
        }
        
        return true;
    }

    // Handler para menu de carteiras
    async handleCarteiraMenu(user, message) {
        if (this.userState[user]?.etapa !== 'menu_carteiras' || !['1', '2'].includes(message)) {
            return false;
        }

        switch (message) {
            case '1': // Listar Carteiras
                await listarCarteiras(this.client, user);
                break;
                
            case '2': // Cadastrar Carteira
                this.userState[user] = { etapa: 'descricao_carteira' };
                await this.client.sendMessage(user, 'Informe a descrição da nova carteira:');
                break;
        }
        
        return true;
    }

    // Handler para menu de categorias
    async handleCategoriaMenu(user, message) {
        if (this.userState[user]?.etapa !== 'menu_categorias' || !['1', '2', '3'].includes(message)) {
            return false;
        }

        switch (message) {
            case '1': // Listar Categorias
                await listarCategorias(this.client, user);
                break;
                
            case '2': // Cadastrar Categoria
                this.userState[user] = { etapa: 'descricao_categoria' };
                await this.client.sendMessage(user, 'Informe a descrição da nova categoria:');
                break;
                
            case '3': // Excluir Categoria
                const categorias = await listCategorias(user);
                const categoriasExclusao = categorias.filter(cat => cat.Usuario !== 'GERAL'); // Exclui categorias gerais
                
                if (categoriasExclusao.length > 0) {
                    const listaFormatada = categoriasExclusao.map(cat => `${cat.Codigo} - ${cat.Descricao}`).join('\n');
                    await this.client.sendMessage(user, `Categorias disponíveis para exclusão:\n${listaFormatada}\n\nInforme o código desejado ou digite "cancelar".`);
                    this.userState[user] = { etapa: 'aguardando_codigo_exclusao' };
                } else {
                    await this.client.sendMessage(user, 'Nenhuma categoria encontrada para exclusão.');
                }
                break;
        }
        
        return true;
    }

    // Handler para menu de relatórios
    async handleReportMenu(user, message) {
        if (this.userState[user]?.etapa !== 'menu_relatorios' || !['1', '2'].includes(message)) {
            return false;
        }

        const { generateStatementReport } = require('./reports');
        
        // Criar um objeto mensagem simulado para passar para a função generateStatementReport
        const msgObj = {
            from: user,
            body: message,
            // Adicionar outros campos necessários para a função
            reply: async (text) => {
                await this.client.sendMessage(user, text);
            }
        };

        // Determinar o formato baseado na seleção do usuário
        const format = message === '1' ? 'pdf' : 'xml';
        
        // Log da seleção do relatório
        await registrarInteracao(
            user,
            'SELECAO_RELATORIO',
            message,
            `Relatório ${format} selecionado`,
            'selecao_relatorio',
            'INICIADO',
            { format }
        );

        // Chamar a função de geração de relatório
        generateStatementReport(this.client, msgObj, format);
        
        return true;
    }

    // Handler para menu de ajuda
    async handleHelpMenu(user, message) {
        if (this.userState[user]?.etapa !== 'menu_ajuda' || !['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(message)) {
            return false;
        }

        let conteudoAjuda = '';
        
        switch (message) {
            case '1': // Guia Rápido
                conteudoAjuda = 'GUIA RÁPIDO DE USO 📱\n\n' +
                    'Bem-vindo ao assistente financeiro! Aqui está um guia rápido para começar:\n\n' +
                    '1️⃣ Para registrar uma entrada de dinheiro, digite "entrada" ou use o menu principal opção 1\n\n' +
                    '2️⃣ Para registrar uma saída, digite "saída" ou use o menu principal opção 2\n\n' +
                    '3️⃣ Para consultar seu saldo, digite "saldo" ou use o menu principal opção 3\n\n' +
                    '4️⃣ Para listar suas carteiras, digite "listar carteiras"\n\n' +
                    '5️⃣ Para listar suas categorias, digite "listar categorias"\n\n' +
                    '6️⃣ Para obter um relatório, digite "pdf" ou "excel"\n\n' +
                    '7️⃣ Para cancelar qualquer operação, digite "cancelar"\n\n' +
                    '8️⃣ Para retornar ao menu principal, digite "menu"\n\n' +
                    'Experimente essas opções para começar. Para ajuda mais detalhada, consulte as outras opções do menu de ajuda.';
                break;
                
            case '2': // Gestão Financeira
                conteudoAjuda = 'GESTÃO FINANCEIRA 💰\n\n' +
                    'Como registrar entradas e saídas:\n\n' +
                    '📥 PARA REGISTRAR UMA ENTRADA:\n' +
                    '   1. Digite "entrada" ou selecione opção 1 no menu\n' +
                    '   2. Informe o valor (ex: 100,50)\n' +
                    '   3. Selecione a carteira pelo código\n' +
                    '   4. Selecione a categoria pelo código\n' +
                    '   5. Confirme digitando "ok"\n\n' +
                    '📤 PARA REGISTRAR UMA SAÍDA:\n' +
                    '   1. Digite "saída" ou selecione opção 2 no menu\n' +
                    '   2. Siga os mesmos passos da entrada\n\n' +
                    '📋 DICAS IMPORTANTES:\n' +
                    '   • Organize suas despesas por categorias\n' +
                    '   • Registre despesas assim que ocorrerem\n' +
                    '   • Use categorias específicas para facilitar análises futuras\n' +
                    '   • Verifique seus saldos regularmente\n\n' +
                    'Para um controle financeiro eficiente, registre todas as transações, mesmo as pequenas.';
                break;
                
            case '3': // Consultas e Saldo
                conteudoAjuda = 'CONSULTAS E SALDO 📊\n\n' +
                    '🔎 COMO CONSULTAR SEU SALDO:\n' +
                    '   • Digite "saldo" ou selecione opção 3 no menu principal\n' +
                    '   • Se tiver várias carteiras, selecione uma pelo código\n' +
                    '   • O saldo atual será exibido\n\n' +
                    '📱 ATALHOS ÚTEIS:\n' +
                    '   • "saldo" - consulta rápida de saldo\n' +
                    '   • "listar carteiras" - ver todas suas carteiras\n' +
                    '   • "listar categorias" - ver todas suas categorias\n\n' +
                    '💡 DICAS:\n' +
                    '   • Consulte o saldo frequentemente para manter controle\n' +
                    '   • Verifique se todas as transações foram registradas\n' +
                    '   • Use os relatórios para uma visão mais detalhada\n' +
                    '   • Crie carteiras diferentes para necessidades específicas (pessoal, negócios, etc.)';
                break;
                
            case '4': // Relatórios e Análises
                conteudoAjuda = 'RELATÓRIOS E ANÁLISES 📈\n\n' +
                    '📄 COMO GERAR RELATÓRIOS:\n' +
                    '   • Digite "pdf" ou "excel" para atalho rápido\n' +
                    '   • Ou acesse o menu principal opção 6\n' +
                    '   • Selecione o formato desejado (PDF ou Excel)\n' +
                    '   • Escolha a carteira para o relatório\n' +
                    '   • Defina o período desejado\n\n' +
                    '📊 TIPOS DE RELATÓRIOS:\n' +
                    '   • PDF: Extrato detalhado com gráficos e resumo por categoria\n' +
                    '   • Excel: Planilha completa para análises personalizadas\n\n' +
                    '🔍 COMO ANALISAR SEUS DADOS:\n' +
                    '   • Verifique os totais por categoria\n' +
                    '   • Identifique tendências de gastos\n' +
                    '   • Compare diferentes períodos\n' +
                    '   • Monitore sua evolução financeira\n\n' +
                    '💡 DICAS:\n' +
                    '   • Gere relatórios mensais para acompanhamento\n' +
                    '   • Use os dados para estabelecer um orçamento\n' +
                    '   • Identifique onde pode economizar';
                break;
                
            case '5': // Personalização
                conteudoAjuda = 'PERSONALIZAÇÃO 🛠️\n\n' +
                    '💼 COMO GERENCIAR CARTEIRAS:\n' +
                    '   • Para criar uma carteira:\n' +
                    '     - Digite "cadastrar carteira" ou use o menu 4 opção 2\n' +
                    '     - Informe a descrição e escolha o tipo\n\n' +
                    '   • Para listar suas carteiras:\n' +
                    '     - Digite "listar carteiras" ou use o menu 4 opção 1\n\n' +
                    '🏷️ COMO GERENCIAR CATEGORIAS:\n' +
                    '   • Para criar uma categoria:\n' +
                    '     - Digite "cadastrar categoria" ou use o menu 5 opção 2\n' +
                    '     - Informe a descrição da categoria\n\n' +
                    '   • Para listar suas categorias:\n' +
                    '     - Digite "listar categorias" ou use o menu 5 opção 1\n\n' +
                    '   • Para excluir uma categoria:\n' +
                    '     - Digite "excluir categoria" ou use o menu 5 opção 3\n' +
                    '     - Selecione a categoria pelo código\n\n' +
                    '💡 DICAS DE ORGANIZAÇÃO:\n' +
                    '   • Crie categorias específicas para melhor controle\n' +
                    '   • Use carteiras diferentes para separar gastos pessoais e profissionais\n' +
                    '   • Revise suas categorias periodicamente';
                break;
                
            case '6': // Dicas Financeiras
                conteudoAjuda = 'DICAS FINANCEIRAS 💡\n\n' +
                    '1️⃣ ORÇAMENTO\n' +
                    '   • Estabeleça um orçamento mensal realista\n' +
                    '   • Registre todas as despesas, mesmo as pequenas\n' +
                    '   • Compare gastos reais com o orçamento regularmente\n\n' +
                    '2️⃣ POUPANÇA\n' +
                    '   • Separe pelo menos 10% da sua renda para poupar\n' +
                    '   • Crie uma categoria "Poupança" para registrar transferências\n' +
                    '   • Estabeleça objetivos de poupança de curto e longo prazo\n\n' +
                    '3️⃣ REDUÇÃO DE GASTOS\n' +
                    '   • Identifique gastos desnecessários através dos relatórios\n' +
                    '   • Procure padrões de despesas que podem ser reduzidos\n' +
                    '   • Compare os gastos mês a mês para monitorar progresso\n\n' +
                    '4️⃣ CATEGORIZAÇÃO EFICIENTE\n' +
                    '   • Use categorias específicas invés de genéricas\n' +
                    '   • Crie subcategorias para gastos maiores\n' +
                    '   • Revise periodicamente suas categorias\n\n' +
                    '5️⃣ MONITORAMENTO CONSTANTE\n' +
                    '   • Verifique seu saldo frequentemente\n' +
                    '   • Gere relatórios mensais para análise\n' +
                    '   • Ajuste seu planejamento baseado nos resultados';
                break;
                
            case '7': // FAQ
                conteudoAjuda = 'PERGUNTAS FREQUENTES (FAQ) ❓\n\n' +
                    '❓ Como posso corrigir uma transação com erro?\n' +
                    '✅ No momento, não é possível editar transações. Recomendamos registrar uma transação contrária para compensar e então registrar a correta.\n\n' +
                    '❓ Posso exportar meus dados para outro sistema?\n' +
                    '✅ Sim, você pode exportar seus dados através dos relatórios em Excel.\n\n' +
                    '❓ Meus dados estão seguros?\n' +
                    '✅ Sim, seus dados são armazenados com segurança e não são compartilhados.\n\n' +
                    '❓ Posso acessar por outros dispositivos?\n' +
                    '✅ Este é um assistente via WhatsApp, então você pode acessar de qualquer dispositivo com seu WhatsApp instalado.\n\n' +
                    '❓ Como faço backup dos meus dados?\n' +
                    '✅ Seus dados são armazenados automaticamente em nosso servidor. Você pode gerar relatórios periodicamente para ter seus próprios backups.\n\n' +
                    '❓ Posso compartilhar uma carteira com outra pessoa?\n' +
                    '✅ Atualmente não há função de compartilhamento. Cada usuário tem acesso apenas às suas próprias carteiras.\n\n' +
                    '❓ Como resolvo se o bot parar de responder?\n' +
                    '✅ Digite "menu" para reiniciar a interação ou aguarde alguns instantes e tente novamente.';
                break;
                
            case '8': // Comandos de Voz
                conteudoAjuda = 'COMANDOS E ATALHOS 🔍\n\n' +
                    '⚡ COMANDOS RÁPIDOS:\n' +
                    '   • "menu" - Abre o menu principal\n' +
                    '   • "entrada" - Inicia registro de entrada\n' +
                    '   • "saída" ou "saida" - Inicia registro de saída\n' +
                    '   • "saldo" - Consulta saldo\n' +
                    '   • "cancelar" - Cancela operação atual\n' +
                    '   • "pdf" - Gera relatório em PDF\n' +
                    '   • "excel" - Gera relatório em Excel\n' +
                    '   • "listar carteiras" - Mostra suas carteiras\n' +
                    '   • "listar categorias" - Mostra suas categorias\n' +
                    '   • "cadastrar carteira" - Inicia cadastro de carteira\n' +
                    '   • "cadastrar categoria" - Inicia cadastro de categoria\n' +
                    '   • "excluir categoria" - Inicia exclusão de categoria\n\n' +
                    '💡 DICAS DE USO:\n' +
                    '   • Você pode enviar mensagens de voz que serão convertidas em texto (em breve)\n' +
                    '   • Use comandos rápidos para economizar tempo\n' +
                    '   • Mantenha suas transações em dia para relatórios precisos';
                break;

            case '9': // Tutoriais Interativos
                this.userState[user] = { etapa: 'menu_tutoriais' };
                await this.client.sendMessage(user, 'Tutoriais Interativos 🎓\n\n' +
                    'Aprenda na prática como usar o sistema:\n\n' +
                    '1 - Como registrar uma entrada\n' +
                    '2 - Como registrar uma saída\n' +
                    '3 - Como gerar um relatório\n' +
                    '4 - Como criar uma nova categoria\n\n' +
                    'Escolha uma opção para iniciar o tutorial:');
                
                await registrarInteracao(
                    user,
                    'MENU_TUTORIAIS',
                    message,
                    'Menu de tutoriais interativos exibido',
                    'tutoriais',
                    'EXIBIDO',
                    {}
                );
                return true;
        }
        
        // Enviar o conteúdo de ajuda ao usuário (para casos 1-8)
        if (conteudoAjuda) {
            await this.client.sendMessage(user, conteudoAjuda);
            
            // Log da interação com a ajuda específica
            await registrarInteracao(
                user,
                'CONTEUDO_AJUDA',
                message,
                `Conteúdo de ajuda exibido: opção ${message}`,
                'visualizacao_ajuda',
                'EXIBIDO',
                { opcaoAjuda: message }
            );
            
            // Perguntar se o usuário deseja ver outra opção de ajuda
            setTimeout(async () => {
                await this.client.sendMessage(user, 'Posso ajudar com mais alguma informação? Digite o número da opção desejada ou "menu" para voltar ao menu principal.');
            }, 2000); // Pequeno delay para melhor experiência do usuário
        }
        
        return true;
    }

    // Handler para menu de assinatura
    async handleSubscriptionMenu(user, message) {
        if (this.userState[user]?.etapa !== 'menu_assinatura' || !['1', '2', '3'].includes(message)) {
            return false;
        }

        switch (message) {
            case '1': // Ver Planos
                const result = await this.exibirPlanos(user);
                if (result) {
                    this.userState[user] = result;
                }
                break;
                
            case '2': // Status da Assinatura
                try {
                    const status = await verificarAssinatura(user);
                    
                    if (status.ativo) {
                        const dataExpiracao = new Date(status.dataExpiracao);
                        const dataFormatada = dataExpiracao.toLocaleDateString('pt-BR');
                        
                        await this.client.sendMessage(user, 
                            `✅ *Assinatura Ativa*\n` +
                            `🔹 Plano: ${status.plano}\n` +
                            `🔹 Válido até: ${dataFormatada}\n\n` +
                            `Para cancelar sua assinatura, digite "cancelar assinatura"`
                        );
                    } else {
                        await this.client.sendMessage(user, 
                            `❌ *Você não possui uma assinatura ativa*\n\n` +
                            `Para conhecer nossos planos, digite "planos"`
                        );
                    }
                } catch (error) {
                    console.error('Erro ao verificar status:', error);
                    await this.client.sendMessage(user, 'Ocorreu um erro ao verificar o status da sua assinatura. Por favor, tente novamente mais tarde.');
                }
                break;
                
            case '3': // Cancelar Assinatura
                this.userState[user] = { etapa: 'confirmar_cancelamento' };
                await this.client.sendMessage(user, 
                    `⚠️ *Tem certeza que deseja cancelar sua assinatura?*\n\n` +
                    `Ao cancelar, você continuará com acesso até o final do período já pago, mas não será renovada automaticamente.\n\n` +
                    `Digite "confirmar" para prosseguir com o cancelamento ou "voltar" para desistir.`
                );
                break;
        }
        
        return true;
    }

    // Handler para menu de tutoriais
    async handleTutorialMenu(user, message) {
        if (this.userState[user]?.etapa !== 'menu_tutoriais' || !['1', '2', '3', '4'].includes(message)) {
            return false;
        }

        switch (message) {
            case '1': // Tutorial de registro de entrada
                this.userState[user] = { 
                    etapa: 'tutorial_entrada',
                    passo: 1,
                    tutorial: {
                        tipo: 'Crédito',
                        valorExemplo: 50.00,
                        carteiraExemplo: 1,
                        categoriaExemplo: 1
                    }
                };
                
                await this.iniciarTutorialEntrada(user);
                break;
                
            case '2': // Tutorial de registro de saída
                this.userState[user] = { 
                    etapa: 'tutorial_saida',
                    passo: 1,
                    tutorial: {
                        tipo: 'Débito',
                        valorExemplo: 25.50,
                        carteiraExemplo: 1,
                        categoriaExemplo: 2
                    }
                };
                
                await this.iniciarTutorialSaida(user);
                break;
                
            case '3': // Tutorial de relatório
                this.userState[user] = { 
                    etapa: 'tutorial_relatorio',
                    passo: 1
                };
                
                await this.iniciarTutorialRelatorio(user);
                break;
                
            case '4': // Tutorial de criação de categoria
                this.userState[user] = { 
                    etapa: 'tutorial_categoria',
                    passo: 1
                };
                
                await this.iniciarTutorialCategoria(user);
                break;
        }
        
        await registrarInteracao(
            user,
            'INICIO_TUTORIAL',
            message,
            `Tutorial ${message} iniciado`,
            'tutorial_iniciado',
            'INICIADO',
            { tutorial: message }
        );
        
        return true;
    }

    // Exibir planos de assinatura
    async exibirPlanos(user) {
        try {
            const mensagem = `🌟 *PLANOS DE ASSINATURA* 🌟\n\n` +
                `*Plano Mensal*\n` +
                `💰 R$ ${PLANOS.MENSAL.valor.toFixed(2).replace('.', ',')}/mês\n` +
                `✅ Acesso a todas as funcionalidades\n` +
                `✅ Relatórios ilimitados\n` +
                `✅ Suporte prioritário\n\n` +
                
                `*Plano Anual*\n` +
                `💰 R$ ${PLANOS.ANUAL.valor.toFixed(2).replace('.', ',')}/ano\n` +
                `✅ Acesso a todas as funcionalidades\n` +
                `✅ Relatórios ilimitados\n` +
                `✅ Suporte prioritário\n` +
                `✅ Economia de ${(PLANOS.MENSAL.valor * 12 - PLANOS.ANUAL.valor).toFixed(2).replace('.', ',')} reais\n\n` +
                
                `Para assinar, digite:\n` +
                `1 - Plano Mensal\n` +
                `2 - Plano Anual`;
            
            await this.client.sendMessage(user, mensagem);
            
            // Log da exibição de planos
            await registrarInteracao(
                user,
                'EXIBIR_PLANOS',
                'Exibição de planos',
                mensagem,
                'assinatura',
                'EXIBIDO',
                {}
            );
            
            return { etapa: 'selecionar_plano' };
        } catch (error) {
            console.error('Erro ao exibir planos:', error);
            await this.client.sendMessage(user, 'Ocorreu um erro ao exibir os planos disponíveis. Por favor, tente novamente mais tarde.');
            return null;
        }
    }

    // Iniciar tutorial de entrada
    async iniciarTutorialEntrada(user) {
        // Enviar mensagem de boas-vindas ao tutorial
        await this.client.sendMessage(user, '🎓 *TUTORIAL: COMO REGISTRAR UMA ENTRADA* 🎓\n\n' +
            'Vamos aprender passo a passo como registrar uma entrada de dinheiro.\n\n' +
            'Este é um tutorial interativo, onde você irá praticar com valores de exemplo (nenhuma transação real será registrada).\n\n' +
            '👉 Para começar, digite "entrada" como se estivesse iniciando uma transação real.');
        
        // Configurar o estado para capturar a próxima interação
        this.userState[user].aguardandoComando = true;
    }

    // Iniciar tutorial de saída
    async iniciarTutorialSaida(user) {
        await this.client.sendMessage(user, '🎓 *TUTORIAL: COMO REGISTRAR UMA SAÍDA* 🎓\n\n' +
            'Vamos aprender passo a passo como registrar uma saída de dinheiro.\n\n' +
            'Este é um tutorial interativo, onde você irá praticar com valores de exemplo (nenhuma transação real será registrada).\n\n' +
            '👉 Para começar, digite "saída" ou "saida" como se estivesse iniciando uma transação real.');
        
        this.userState[user].aguardandoComando = true;
    }

    // Iniciar tutorial de relatório
    async iniciarTutorialRelatorio(user) {
        await this.client.sendMessage(user, '🎓 *TUTORIAL: COMO GERAR UM RELATÓRIO* 🎓\n\n' +
            'Vamos aprender passo a passo como gerar um relatório financeiro.\n\n' +
            'Este é um tutorial interativo, onde você irá praticar os comandos (nenhum relatório real será gerado).\n\n' +
            '👉 Para começar, digite "pdf" para simular a geração de um relatório em PDF.');
        
        this.userState[user].aguardandoComando = true;
    }

    // Iniciar tutorial de categoria
    async iniciarTutorialCategoria(user) {
        await this.client.sendMessage(user, '🎓 *TUTORIAL: COMO CRIAR UMA NOVA CATEGORIA* 🎓\n\n' +
            'Vamos aprender passo a passo como criar uma nova categoria de despesas ou receitas.\n\n' +
            'Este é um tutorial interativo, onde você irá praticar os comandos (nenhuma categoria real será criada).\n\n' +
            '👉 Para começar, digite "cadastrar categoria" como se estivesse criando uma categoria real.');
        
        this.userState[user].aguardandoComando = true;
    }

    // Processar passos do tutorial de entrada
    async processarTutorialEntrada(user, message) {
        const passo = this.userState[user].passo;
        const tutorial = this.userState[user].tutorial;
        
        switch (passo) {
            case 1: // Usuário digitou "entrada"
                if (message.toLowerCase() === 'entrada') {
                    this.userState[user].passo = 2;
                    
                    // Simular resposta do sistema
                    await this.client.sendMessage(user, 'Informe o valor da entrada:');
                    
                    // Instrução para o próximo passo
                    setTimeout(async () => {
                        await this.client.sendMessage(user, '✅ Muito bem! O sistema está pedindo o valor da entrada.\n\n' +
                            `👉 Agora, digite "${tutorial.valorExemplo.toFixed(2).replace('.', ',')}" como valor de exemplo.`);
                    }, 1000);
                } else {
                    await this.client.sendMessage(user, '❌ Para iniciar o registro de uma entrada, você deve digitar "entrada".\n\n' +
                        '👉 Por favor, digite "entrada" para continuar o tutorial.');
                }
                break;
                
            case 2: // Usuário digitou o valor
                // Verificar se o valor está no formato correto (pode ser mais flexível para fins de tutorial)
                const valorFormatado = message.replace(',', '.');
                const valor = parseFloat(valorFormatado);
                
                if (!isNaN(valor) && valor > 0) {
                    this.userState[user].passo = 3;
                    
                    // Buscar carteiras para usar no exemplo
                    const carteiras = await getCarteiras(user);
                    let carteiraMsg = '';
                    
                    if (carteiras.length > 0) {
                        carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
                    } else {
                        // Se o usuário não tiver carteiras, criar uma mensagem simulada
                        carteiraMsg = '1 - Carteira Principal';
                    }
                    
                    // Simular resposta do sistema
                    await this.client.sendMessage(user, `Qual carteira?\n${carteiraMsg}\n(Envie o código da carteira)`);
                    
                    // Instrução para o próximo passo
                    setTimeout(async () => {
                        await this.client.sendMessage(user, '✅ Excelente! O sistema mostrou suas carteiras disponíveis.\n\n' +
                            `👉 Agora, selecione a carteira digitando "${tutorial.carteiraExemplo}".`);
                    }, 1000);
                } else {
                    await this.client.sendMessage(user, '❌ O valor informado parece não ser válido.\n\n' +
                        `👉 Por favor, digite "${tutorial.valorExemplo.toFixed(2).replace('.', ',')}" como valor de exemplo.`);
                }
                break;
                
            case 3: // Usuário selecionou a carteira
                // Para o tutorial, aceitamos qualquer número como válido
                if (/^\d+$/.test(message)) {
                    this.userState[user].passo = 4;
                    
                    // Buscar categorias para usar no exemplo
                    const categorias = await getCategorias(user);
                    let categoriaMsg = '';
                    
                    if (categorias.length > 0) {
                        categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
                    } else {
                        // Se o usuário não tiver categorias, criar uma mensagem simulada
                        categoriaMsg = '1 - Salário\n2 - Rendimentos\n3 - Outros';
                    }
                    
                    // Simular resposta do sistema
                    await this.client.sendMessage(user, `Qual categoria?\n${categoriaMsg}\n(Envie o código da categoria)`);
                    
                    // Instrução para o próximo passo
                    setTimeout(async () => {
                        await this.client.sendMessage(user, '✅ Perfeito! O sistema mostrou suas categorias disponíveis.\n\n' +
                            `👉 Agora, selecione a categoria digitando "${tutorial.categoriaExemplo}".`);
                    }, 1000);
                } else {
                    await this.client.sendMessage(user, '❌ Para selecionar uma carteira, você deve digitar o código numérico dela.\n\n' +
                        `👉 Por favor, digite "${tutorial.carteiraExemplo}" para selecionar a carteira de exemplo.`);
                }
                break;
                
            case 4: // Usuário selecionou a categoria
                // Para o tutorial, aceitamos qualquer número como válido
                if (/^\d+$/.test(message)) {
                    this.userState[user].passo = 5;
                    
                    // Simular a tela de confirmação
                    const confirmaMsg = `Confirme os dados:\nTipo: ${tutorial.tipo}\nValor: R$ ${tutorial.valorExemplo.toFixed(2).replace('.', ',')}\nCarteira: ${tutorial.carteiraExemplo}\nCategoria: ${tutorial.categoriaExemplo}\nResponda "Ok" para salvar.`;
                    
                    await this.client.sendMessage(user, confirmaMsg);
                    
                    // Instrução para o próximo passo
                    setTimeout(async () => {
                        await this.client.sendMessage(user, '✅ Ótimo! O sistema está mostrando um resumo da transação para sua confirmação.\n\n' +
                            '👉 Para finalizar, digite "Ok" para simular a confirmação.');
                    }, 1000);
                } else {
                    await this.client.sendMessage(user, '❌ Para selecionar uma categoria, você deve digitar o código numérico dela.\n\n' +
                        `👉 Por favor, digite "${tutorial.categoriaExemplo}" para selecionar a categoria de exemplo.`);
                }
                break;
                
            case 5: // Usuário confirmou a transação
                if (message.toLowerCase() === 'ok') {
                    // Simular mensagem de sucesso
                    await this.client.sendMessage(user, 'Movimentação registrada com sucesso!');
                    
                    // Finalização do tutorial
                    setTimeout(async () => {
                        await this.client.sendMessage(user, '🎉 *PARABÉNS! VOCÊ COMPLETOU O TUTORIAL!* 🎉\n\n' +
                            'Você aprendeu como registrar uma entrada financeira seguindo estes passos:\n\n' +
                            '1️⃣ Digitar "entrada" para iniciar\n' +
                            '2️⃣ Informar o valor\n' +
                            '3️⃣ Selecionar a carteira\n' +
                            '4️⃣ Selecionar a categoria\n' +
                            '5️⃣ Confirmar a transação\n\n' +
                            'Lembre-se: O que você acabou de fazer foi uma simulação. Nenhuma transação real foi registrada.\n\n' +
                            '✅ Gostaria de:\n' +
                            '1 - Tentar outro tutorial\n' +
                            '2 - Voltar ao menu de ajuda\n' +
                            '3 - Voltar ao menu principal');
                        
                        // Configurar estado para a escolha final
                        this.userState[user].etapa = 'tutorial_finalizado';
                    }, 1500);
                } else {
                    await this.client.sendMessage(user, '❌ Para confirmar a transação, você deve digitar "Ok".\n\n' +
                        '👉 Por favor, digite "Ok" para finalizar o tutorial.');
                }
                break;
        }
    }

    // Processar escolha após finalização do tutorial
    async handleTutorialFinished(user, message) {
        if (this.userState[user]?.etapa !== 'tutorial_finalizado' || !['1', '2', '3'].includes(message)) {
            return false;
        }

        switch (message) {
            case '1': // Tentar outro tutorial
                this.userState[user] = { etapa: 'menu_tutoriais' };
                await this.client.sendMessage(user, 'Tutoriais Interativos 🎓\n\n' +
                    'Aprenda na prática como usar o sistema:\n\n' +
                    '1 - Como registrar uma entrada\n' +
                    '2 - Como registrar uma saída\n' +
                    '3 - Como gerar um relatório\n' +
                    '4 - Como criar uma nova categoria\n\n' +
                    'Escolha uma opção para iniciar o tutorial:');
                break;
                
            case '2': // Voltar ao menu de ajuda
                this.userState[user] = { etapa: 'menu_ajuda' };
                await this.client.sendMessage(user, 'Menu de Ajuda:\n1 - Guia Rápido\n2 - Gestão Financeira\n3 - Consultas e Saldo\n4 - Relatórios e Análises\n5 - Personalização\n6 - Dicas Financeiras\n7 - FAQ\n8 - Comandos de Voz\n9 - Tutoriais Interativos');
                break;
                
            case '3': // Voltar ao menu principal
                this.userState[user] = { etapa: 'menu' };
                await this.client.sendMessage(user, 'Menu Principal:\n1 - Entradas\n2 - Saídas\n3 - Ver Saldo\n4 - Carteiras\n5 - Categorias\n6 - Relatórios\n7 - Manutenções\n8 - Ajuda\n9 - Assinatura');
                break;
        }
        
        return true;
    }

    // Processar confirmação de cancelamento de assinatura
    async handleConfirmCancelSubscription(user, message) {
        if (this.userState[user]?.etapa !== 'confirmar_cancelamento') {
            return false;
        }

        if (message.toLowerCase() === 'confirmar') {
            try {
                const resultado = await cancelarAssinatura(user);
                
                if (resultado.sucesso) {
                    await this.client.sendMessage(user, 
                        `✅ *Assinatura cancelada com sucesso*\n\n` +
                        `Seu acesso permanecerá ativo até o final do período já pago.\n\n` +
                        `Esperamos que volte em breve!`
                    );
                } else {
                    await this.client.sendMessage(user, 
                        `❌ *Não foi possível cancelar a assinatura*\n\n` +
                        `${resultado.mensagem}\n\n` +
                        `Por favor, tente novamente mais tarde ou entre em contato com o suporte.`
                    );
                }
            } catch (error) {
                console.error('Erro ao cancelar assinatura:', error);
                await this.client.sendMessage(user, 'Ocorreu um erro ao processar o cancelamento. Por favor, tente novamente mais tarde.');
            }
            
            delete this.userState[user];
            return true;
        } else if (message.toLowerCase() === 'voltar') {
            delete this.userState[user];
            await this.client.sendMessage(user, 'Operação cancelada. Sua assinatura continua ativa.');
            return true;
        } else {
            await this.client.sendMessage(user, 'Opção inválida. Digite "confirmar" para cancelar sua assinatura ou "voltar" para desistir.');
            return true;
        }
    }

    // Processar seleção de plano
    async handlePlanSelection(user, message) {
        if (this.userState[user]?.etapa !== 'selecionar_plano') {
            return false;
        }

        if (['1', '2'].includes(message)) {
            const planoEscolhido = message === '1' ? 'MENSAL' : 'ANUAL';
            
            try {
                const resultado = await iniciarAssinatura(user, planoEscolhido);
                
                if (resultado.sucesso) {
                    await this.client.sendMessage(user, 
                        `🔗 *Link para assinatura gerado com sucesso!*\n\n` +
                        `Para concluir sua assinatura, acesse o link abaixo:\n${resultado.link}\n\n` +
                        `Após o pagamento, seu plano será ativado automaticamente.`
                    );
                } else {
                    await this.client.sendMessage(user, 
                        `❌ *Não foi possível gerar o link de pagamento*\n\n` +
                        `${resultado.mensagem}\n\n` +
                        `Por favor, tente novamente mais tarde ou entre em contato com o suporte.`
                    );
                }
            } catch (error) {
                console.error('Erro ao processar escolha de plano:', error);
                await this.client.sendMessage(user, 'Ocorreu um erro ao processar sua escolha. Por favor, tente novamente mais tarde.');
            }
            
            delete this.userState[user];
            return true;
        } else if (message.toLowerCase() === 'cancelar') {
            delete this.userState[user];
            await this.client.sendMessage(user, 'Operação cancelada.');
            return true;
        } else {
            await this.client.sendMessage(user, 'Opção inválida. Digite 1 para o Plano Mensal, 2 para o Plano Anual ou "cancelar" para cancelar a operação.');
            return true;
        }
    }
}

module.exports = { MenuHandler };