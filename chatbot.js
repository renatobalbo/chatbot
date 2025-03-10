require('dotenv').config();
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');

const { getConnection, sql } = require('./database');
const { registrarInteracao } = require('./interactionLog');
const { generateStatementReport } = require('./reports');
const { getCarteiras, saveCarteiraToDB, getCarteiraIdPorCodigo, consultarSaldo, exibirSaldo, listarCarteiras } = require('./wallets');
const { getCategorias, saveCategoriaToDB, checkCategoriaExists, checkCategoriaInUse, deleteCategoriaFromDB, listCategorias, listarCategorias } = require('./categories');
const simpleGit = require('simple-git');

const userManager = require('./userManagement');

const git = simpleGit({
  baseDir: process.cwd(),
  binary: 'git',
  maxConcurrentProcesses: 6,
  config: [
    `http.extraheader=AUTHORIZATION: token ${process.env.GITHUB_TOKEN}`
  ]
});

const client = new Client();

//Chamada do QRCode e conexão com o Whatsapp
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

// Estado do usuário
const userState = {};

// Função para salvar movimentações no banco.
const saveTransactionToDB = async (user, tipo, valor, carteiraCodigo, categoria) => {
    try {
        let pool = await getConnection();

        // Busca o ID da carteira com base no código informado
        const carteiraResult = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, carteiraCodigo)
            .query("SELECT ID FROM Carteiras WHERE Codigo = @Codigo AND (Usuario = @Usuario OR Usuario = 'GERAL')");

        if (carteiraResult.recordset.length === 0) {
            const erro = `Carteira com código ${carteiraCodigo} não encontrada.`;
            
            // Log de erro na carteira
            await registrarInteracao(
                user,
                'ERRO_CARTEIRA',
                carteiraCodigo.toString(),
                erro,
                'consulta_carteira',
                'ERRO',
                { carteiraCodigo }
            );
            
            throw new Error(erro);
        }

        const carteiraID = carteiraResult.recordset[0].ID;

        await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Data', sql.DateTime, new Date())
            .input('Tipo', sql.NVarChar, tipo)
            .input('Valor', sql.Decimal(10,2), parseFloat(valor))
            .input('Carteira', sql.Int, carteiraID)
            .input('Categoria', sql.Int, categoria)
            .query("INSERT INTO Movimentacoes (Usuario, Data, Tipo, Valor, Carteira, Categoria) VALUES (@Usuario, @Data, @Tipo, @Valor, @Carteira, @Categoria)");
        
        // Log de sucesso na transação
        await registrarInteracao(
            user,
            'TRANSACAO',
            'saveTransactionToDB',
            `Transação ${tipo} salva com sucesso`,
            'banco_dados',
            'SUCESSO',
            {
                tipo,
                valor: parseFloat(valor),
                carteiraID,
                categoria
            }
        );
    } catch (err) {
        console.error('Erro ao salvar movimentação:', err.message);
        
        // Log de erro na transação
        await registrarInteracao(
            user,
            'TRANSACAO',
            'saveTransactionToDB',
            `Erro: ${err.message}`,
            'banco_dados',
            'ERRO',
            {
                tipo,
                valor,
                carteiraCodigo,
                categoria,
                erro: err.message
            }
        );
        
        throw err; // Re-throw para tratamento superior
    }
};

// Montagem das Mensagens.
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

    if (!userState[user]) {
        userState[user] = {};
    }

    // Chamada do Menu Principal.
    if (message.toLowerCase() === 'menu') {
        userState[user] = { etapa: 'menu' };
        const menuMsg = 'Menu Principal:\n1 - Entradas\n2 - Saídas\n3 - Ver Saldo\n4 - Carteiras\n5 - Categorias\n6 - Relatórios';
        await client.sendMessage(user, menuMsg);
        
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
    }
    if (userState[user]?.etapa === 'menu' && ['1', '2', '3', '4', '5', '6'].includes(message)) {
        switch (message) {
            case '1':
                userState[user] = { etapa: 'valor', tipo: 'Crédito' };
                await client.sendMessage(user, 'Informe o valor da entrada:');
                break;
            case '2':
                userState[user] = { etapa: 'valor', tipo: 'Débito' };
                await client.sendMessage(user, 'Informe o valor da saída:');
                break;
            case '3':
                const result = await consultarSaldo(client, user);
                if (result && result.etapa) {
                    userState[user].etapa = result.etapa;
                }
                break;
            case '4':
                userState[user] = { etapa: 'menu_carteiras' };
                await client.sendMessage(user, 'Menu Carteiras:\n1 - Listar Carteiras\n2 - Cadastrar Carteira');
                break;
            case '5':
                userState[user] = { etapa: 'menu_categorias' };
                await client.sendMessage(user, 'Menu Categorias:\n1 - Listar Categorias\n2 - Cadastrar Categoria\n3 - Excluir Categoria');
                break;
            case '6':
                userState[user] = { etapa: 'menu_relatorios' };
                await client.sendMessage(user, 'Menu Relatórios:\n1 - Extrato em PDF\n2 - Extrato em Excel');
                break;
        }
        return;
    }

    // Submenu Carteiras
    if (userState[user]?.etapa === 'menu_carteiras' && ['1', '2'].includes(message)) {
        switch (message) {
            case '1':
                await listarCarteiras(client, user);
                break;
            case '2':
                userState[user] = { etapa: 'descricao_carteira' };
                await client.sendMessage(user, 'Informe a descrição da nova carteira:');
                break;
        }
        return;
    }

    // Submenu Categorias
    if (userState[user]?.etapa === 'menu_categorias' && ['1', '2', '3'].includes(message)) {
        switch (message) {
            case '1':
                await listarCategorias(client, user);
                break;
            case '2':
                userState[user] = { etapa: 'descricao_categoria' };
                await client.sendMessage(user, 'Informe a descrição da nova categoria:');
                break;
            case '3':
                const categorias3 = await listCategorias(user);
                const categoriasExclusao = categorias3.filter(cat => cat.Usuario !== 'GERAL'); // Exclui categorias gerais
                if (categoriasExclusao.length > 0) {
                    const listaFormatada = categoriasExclusao.map(cat => `${cat.Codigo} - ${cat.Descricao}`).join('\n');
                    await client.sendMessage(user, `Categorias disponíveis para exclusão:\n${listaFormatada}\n\nInforme o código desejado ou digite "cancelar".`);
                    userState[user] = { etapa: 'aguardando_codigo_exclusao' };
                } else {
                    await client.sendMessage(user, 'Nenhuma categoria encontrada para exclusão.');
                }
                return;
        }
        return;
    }
    
    // Submenu Relatórios
    if (userState[user]?.etapa === 'menu_relatorios' && ['1', '2'].includes(message)) {
        const format = message === '1' ? 'pdf' : 'xml';
        generateStatementReport(client, msg, format);
    }
 
    // Atalho das chamadas 'entrada' e 'saída'.
    if (message.toLowerCase() === 'entrada' || ['saída', 'saida'].includes(message.toLowerCase())) {
        userState[user] = { etapa: 'valor', tipo: message.toLowerCase() === 'entrada' ? 'Crédito' : 'Débito' };
        await client.sendMessage(user, 'Qual valor?');
        return;
    }
    
    if (userState[user].etapa === 'valor') {
        const valor = parseFloat(message.replace(',', '.'));
        if (isNaN(valor) || valor <= 0) {
            await client.sendMessage(user, 'Valor inválido. Por favor, digite um número válido.');
            return;
        }
        userState[user].valor = valor.toFixed(2); // Manter o valor original formatado para cálculos
    
        // Adicionar uma propriedade para o valor formatado para exibição
        userState[user].valorFormatado = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(valor);
        
        const carteiras = await getCarteiras(user);

        if (carteiras.length === 1 && carteiras[0].Codigo === 1) { // Verificação ajustada para número
            userState[user].carteira = 1;
            userState[user].etapa = 'categoria';
            const categorias = await getCategorias(user);
            const categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
            await client.sendMessage(user, `Qual categoria?\n${categoriaMsg}\n(Envie o código da categoria)`);
            return;
        }

        userState[user].etapa = 'carteira';
        const carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Qual carteira?\n${carteiraMsg}\n(Envie o código da carteira)`);
        return;
    }

    if (userState[user].etapa === 'carteira') {
        const carteiras = await getCarteiras(user);
        const carteiraSelecionada = carteiras.find(c => String(c.Codigo) === String(message));
        if (!carteiraSelecionada) {
            await client.sendMessage(user, 'Código de carteira inválido. Escolha uma das opções apresentadas.');
            return;
        }
        userState[user].carteira = carteiraSelecionada.Codigo;
        userState[user].etapa = 'categoria';
        const categorias = await getCategorias(user);

        const categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Qual categoria?\n${categoriaMsg}\n(Envie o código da categoria)`);
        return;
    }

    if (userState[user].etapa === 'categoria') {
        const categorias = await getCategorias(user);
        const categoriaSelecionada = categorias.find(c => c.Codigo === parseInt(message));
        if (!categoriaSelecionada) {
            await client.sendMessage(user, 'Código de categoria inválido. Escolha uma das opções apresentadas.');
            return;
        }
        userState[user].categoria = categoriaSelecionada.Codigo;
        userState[user].etapa = 'confirmacao';
    
    
        const carteiras = await getCarteiras(user); // Busca a lista de carteiras novamente
        const carteiraDescricao = carteiras.find(c => c.Codigo === userState[user].carteira)?.Descricao || 'Não encontrado';
        const resumo = `Confirme os dados:\nTipo: ${userState[user].tipo}\nValor: ${userState[user].valorFormatado}\nCarteira: ${userState[user].carteira} - ${carteiraDescricao}\nCategoria: ${categoriaSelecionada.Codigo} - ${categoriaSelecionada.Descricao}\nResponda "Ok" para salvar.`;
        
        await client.sendMessage(user, resumo);
        
        return;
    }

    if (userState[user].etapa === 'confirmacao' && message.toLowerCase() === 'ok') {
        try {
            await saveTransactionToDB(user, userState[user].tipo, userState[user].valor, userState[user].carteira, userState[user].categoria);
            
            const mensagemSucesso = 'Movimentação registrada com sucesso!';
            await client.sendMessage(user, mensagemSucesso);
            
            // Log da transação bem-sucedida
            await registrarInteracao(
                user,
                userState[user].tipo === 'Crédito' ? 'ENTRADA_FINANCEIRA' : 'SAIDA_FINANCEIRA',
                message,
                mensagemSucesso,
                'confirmacao',
                'SUCESSO',
                {
                    valor: userState[user].valor,
                    carteira: userState[user].carteira,
                    categoria: userState[user].categoria
                }
            );
            
            delete userState[user];
        } catch (error) {
            console.error('Erro ao salvar transação:', error);
            const mensagemErro = 'Erro ao registrar movimentação. Tente novamente.';
            await client.sendMessage(user, mensagemErro);
            
            // Log de erro
            await registrarInteracao(
                user,
                userState[user].tipo === 'Crédito' ? 'ENTRADA_FINANCEIRA' : 'SAIDA_FINANCEIRA',
                message,
                mensagemErro,
                'confirmacao',
                'ERRO',
                {
                    valor: userState[user].valor,
                    carteira: userState[user].carteira,
                    categoria: userState[user].categoria,
                    erro: error.message
                }
            );
        }
        return;
    }

    // Atalho da chamada de Cadastro de Carteira.
    if (message === 'cadastrar carteira') {
        userState[user] = { etapa: 'descricao_carteira' };
        await client.sendMessage(user, 'Qual descrição da carteira?');
        return;
    }

    if (userState[user].etapa === 'descricao_carteira') {
        userState[user].descricaoCarteira = message;
        userState[user].etapa = 'tipo_carteira';
        await client.sendMessage(user, 'Escolha o tipo da carteira:\n1 - Dinheiro\n2 - Cartão de Crédito\n3 - Cartão de Débito\n4 - Conta Bancária');
        return;
    }
    
    if (userState[user]?.etapa === 'tipo_carteira') {
        if (message.toLowerCase() === 'cancelar') {
            const etapaAnterior = userState[user]?.etapa || 'desconhecida';
            const operacaoAtual = userState[user]?.tipo || 'OPERACAO';
            delete userState[user];
            
            const mensagemCancelamento = 'Operação cancelada.';
            await client.sendMessage(user, mensagemCancelamento);
            
            // Log do cancelamento
            await registrarInteracao(
                user,
                'CANCELAMENTO',
                message,
                mensagemCancelamento,
                etapaAnterior,
                'CANCELADO',
                { operacao: operacaoAtual }
            );
            return;
        }
        const tiposCarteira = {
            '1': 'Dinheiro',
            '2': 'Cartão de Crédito',
            '3': 'Cartão de Débito',
            '4': 'Conta Bancária'
        };
    
        const tipoSelecionado = tiposCarteira[message];
        if (!tipoSelecionado) {
            await client.sendMessage(user, 'Opção inválida. Por favor, escolha uma opção válida:\n1 - Dinheiro\n2 - Cartão de Crédito\n3 - Cartão de Débito\n4 - Conta Bancária');
            return;
        }
    
        userState[user].tipoCarteira = tipoSelecionado;
        userState[user].etapa = 'confirmacao_carteira';
        await saveCarteiraToDB(user, userState[user].descricaoCarteira, tipoSelecionado);
        await client.sendMessage(user, `Carteira "${userState[user].descricaoCarteira}" do tipo "${tipoSelecionado}" criada com sucesso!`);
        delete userState[user];
        return;
    }     

    // Atalho da chamada de Cadastro de Categoria.
    if (message === 'cadastrar categoria') {
        userState[user] = { etapa: 'descricao_categoria' };
        await client.sendMessage(user, 'Qual descrição da categoria?');
        return;
    }

    if (userState[user]?.etapa === 'descricao_categoria') {
        if (message.toLowerCase() === 'cancelar') {
            const etapaAnterior = userState[user]?.etapa || 'desconhecida';
            const operacaoAtual = userState[user]?.tipo || 'OPERACAO';
            delete userState[user];
            
            const mensagemCancelamento = 'Operação cancelada.';
            await client.sendMessage(user, mensagemCancelamento);
            
            // Log do cancelamento
            await registrarInteracao(
                user,
                'CANCELAMENTO',
                message,
                mensagemCancelamento,
                etapaAnterior,
                'CANCELADO',
                { operacao: operacaoAtual }
            );
            return;
        }

        const categoriaExistente = await checkCategoriaExists(user, message.trim().toLowerCase());
        if (categoriaExistente) {
            await client.sendMessage(user, 'Esta categoria já existe. Por favor, escolha outra descrição.');
            return;
        }

        await saveCategoriaToDB(user, message.trim());
        await client.sendMessage(user, 'Categoria cadastrada com sucesso!');
        delete userState[user];
        return;
    }

    // Etapas para exclusão de Categoria via Menu.
    if (userState[user]?.etapa === 'aguardando_codigo_exclusao') {
        if (message.toLowerCase() === 'cancelar') {
            const etapaAnterior = userState[user]?.etapa || 'desconhecida';
            const operacaoAtual = userState[user]?.tipo || 'OPERACAO';
            delete userState[user];
            
            const mensagemCancelamento = 'Operação cancelada.';
            await client.sendMessage(user, mensagemCancelamento);
            
            // Log do cancelamento
            await registrarInteracao(
                user,
                'CANCELAMENTO',
                message,
                mensagemCancelamento,
                etapaAnterior,
                'CANCELADO',
                { operacao: operacaoAtual }
            );
            return;
        }
        await deleteCategoriaFromDB(user, message); // Usa o código informado para excluir
        userState[user] = { etapa: 'menu_categorias' }; // Volta pro menu de categorias após a exclusão
        await client.sendMessage(user, 'Categoria excluída com sucesso!');
        return;
    }

    // Atalho da chamada de Exclusão de Categoria.
    if (message === 'excluir categoria') {
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

    if (userState[user]?.etapa === 'selecionar_categoria_exclusao') {
        if (message.toLowerCase() === 'cancelar') {
            const etapaAnterior = userState[user]?.etapa || 'desconhecida';
            const operacaoAtual = userState[user]?.tipo || 'OPERACAO';
            delete userState[user];
            
            const mensagemCancelamento = 'Operação cancelada.';
            await client.sendMessage(user, mensagemCancelamento);
            
            // Log do cancelamento
            await registrarInteracao(
                user,
                'CANCELAMENTO',
                message,
                mensagemCancelamento,
                etapaAnterior,
                'CANCELADO',
                { operacao: operacaoAtual }
            );
            return;
        }
    
        const categoriaSelecionada = userState[user].categorias.find(cat => cat.Codigo === parseInt(message));
    
        if (!categoriaSelecionada) {
            await client.sendMessage(user, 'Código inválido. Por favor, selecione um código da lista.');
            return;
        }
    
        if (categoriaSelecionada.Usuario !== user) {
            await client.sendMessage(user, 'Você só pode excluir categorias que você mesmo criou.');
            delete userState[user];
            return;
        }
    
        const codigoCategoria = parseInt(categoriaSelecionada.Codigo);
    
        if (isNaN(codigoCategoria)) {
            await client.sendMessage(user, 'Houve um erro ao interpretar o código da categoria. Tente novamente.');
            delete userState[user];
            return;
        }
    
        const categoriaEmUso = await checkCategoriaInUse(user, codigoCategoria);
        if (categoriaEmUso) {
            await client.sendMessage(user, 'Esta categoria já foi utilizada e não poderá ser excluída.');
            delete userState[user];
            return;
        }
    
        const categoriaExcluida = await deleteCategoriaFromDB(user, categoriaSelecionada.Codigo);
        if (categoriaExcluida) {
            await client.sendMessage(user, 'Categoria excluída com sucesso!');
        } else {
            await client.sendMessage(user, 'Ocorreu um erro ao tentar excluir a categoria.');
        }
    
        delete userState[user];
        return;
    }

    // Atalho da chamada que cancela a operação.
    if (message.toLowerCase() === 'cancelar') {
        const etapaAnterior = userState[user]?.etapa || 'desconhecida';
        const operacaoAtual = userState[user]?.tipo || 'OPERACAO';
        delete userState[user];
        
        const mensagemCancelamento = 'Operação cancelada.';
        await client.sendMessage(user, mensagemCancelamento);
        
        // Log do cancelamento
        await registrarInteracao(
            user,
            'CANCELAMENTO',
            message,
            mensagemCancelamento,
            etapaAnterior,
            'CANCELADO',
            { operacao: operacaoAtual }
        );
        return;
    }

    // Atalho da chamada de Saldo.
    if (message.toLowerCase() === 'saldo') {
        const result = await consultarSaldo(client, user);
        if (result && result.etapa) {
            userState[user].etapa = result.etapa;
        }
        return;
    }

    // Atalho da chamada Listar Carteiras.
    if (message.toLowerCase() === 'listar carteiras') {
        await listarCarteiras(client, user);
        return;
    }
        
    // Atalho da chamada Listar Categorias.
    if (message.toLowerCase() === 'listar categorias') {
        await listarCategorias(client, user);
        return;
    }

    // Lidar com seleção de carteira para saldo
    if (userState[user]?.etapa === 'selecionarCarteiraSaldo') {
        const carteiras = await getCarteiras(user);
        const carteiraSelecionada = carteiras.find(c => c.Codigo === parseInt(message));
        
        if (!carteiraSelecionada) {
            await client.sendMessage(user, 'Código de carteira inválido. Escolha uma das opções apresentadas.');
            return;
        }
        
        await exibirSaldo(client, user, carteiraSelecionada.Codigo);
        delete userState[user].etapa;
        return;
    }

    // Adicionar novos comandos para gerenciar usuários (apenas para administradores)
    async function isAdminUser(user) {
        // Implementar lógica para identificar administradores
        // Por exemplo, uma lista de números de telefone de administradores
        const adminUsers = ['554396697747@c.us']; // Exemplo, substituir pelos números reais
        return adminUsers.includes(user);
    }
    
    // Dentro do event handler 'message', adicionar os comandos de administração
    if (message.toLowerCase() === 'admin menu' && await isAdminUser(user)) {
        await client.sendMessage(user, 'Menu de Administração:\n1 - Listar Usuários\n2 - Tornar Usuário PRO\n3 - Desativar Usuário\n4 - Reativar Usuário');
        userState[user] = { etapa: 'admin_menu' };
        return;
    }

    // Processar a seleção do menu de administração
    if (userState[user]?.etapa === 'admin_menu' && await isAdminUser(user)) {
        switch (message) {
            case '1': // Listar Usuários
                // Implementar função para listar usuários
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
        }
        return;
    }

    // Implementar função para listar usuários (apenas para admins)
    async function listUsers(adminUser) {
        if (!await isAdminUser(adminUser)) return;
        
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

});

client.initialize();
