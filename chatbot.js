require('dotenv').config();
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');

const { getConnection, sql } = require('./database');
const { generateStatementReport } = require('./reports');

const simpleGit = require('simple-git');

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

// Função para obter o próximo código válido.
const getNextCodigo = async (table, user) => {
    try {
        let pool = await getConnection();
        let result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query(`
                SELECT ISNULL(MAX(Codigo), 0) + 1 AS NextCodigo
                FROM ${table}
                WHERE Usuario = @Usuario OR Usuario = 'GERAL'
            `);

        let nextCodigo = result.recordset[0].NextCodigo;

        // Certifica-se de que o código ainda não existe para o usuário específico
        let check = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, nextCodigo)
            .query(`SELECT COUNT(*) AS Count FROM ${table} WHERE Usuario = @Usuario AND Codigo = @Codigo`);

        if (check.recordset[0].Count > 0) {
            // Se já existir, busca o próximo disponível
            let resultAlt = await pool.request()
                .input('Usuario', sql.NVarChar, user)
                .query(`
                    SELECT MIN(Codigo + 1) AS NextCodigo 
                    FROM ${table} 
                    WHERE Usuario = @Usuario 
                    AND (Codigo + 1) NOT IN (SELECT Codigo FROM ${table} WHERE Usuario = @Usuario)
                `);

            nextCodigo = resultAlt.recordset[0].NextCodigo || nextCodigo;
        }
        return nextCodigo;
    } catch (err) {
        console.error(`Erro ao obter próximo código para ${table}:`, err);
        return 1;
    }
};

// Função para obter opções de carteira do usuário.
const getCarteiras = async (user) => {
    try {
        let pool = await getConnection();
        let result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query("SELECT Codigo, Descricao FROM Carteiras WHERE Usuario = @Usuario OR Usuario = 'GERAL'");
        return result.recordset;
    } catch (err) {
        console.error('Erro ao buscar carteiras:', err);
        return [];
    }
};

// Função para obter opções de categoria do usuário.
const getCategorias = async (user) => {
    try {
        let pool = await getConnection();
        let result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query("SELECT Codigo, Descricao FROM Categorias WHERE Usuario = @Usuario OR Usuario = 'GERAL'");
        return result.recordset;
    } catch (err) {
        console.error('Erro ao buscar categorias:', err);
        return [];
    }
};

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
            throw new Error(`Carteira com código ${carteiraCodigo} não encontrada.`);
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
    } catch (err) {
        console.error('Erro ao salvar movimentação:', err.message);
    }
};

// Função para cadastrar carteira.
const saveCarteiraToDB = async (user, descricao, tipo) => {
    try {
        let pool = await getConnection();

        let codigo = await getNextCodigo('Carteiras', user);

        // Verifica se o código gerado já existe
        let check = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .query("SELECT COUNT(*) AS Count FROM Carteiras WHERE Usuario = @Usuario AND Codigo = @Codigo");

        if (check.recordset[0].Count > 0) {
            console.error(`Código ${codigo} já existe para o usuário ${user}, gerando novo código...`);
            codigo = await getNextCodigo('Carteiras', user); // Tenta gerar novamente
        }

        await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .input('Descricao', sql.NVarChar, descricao)
            .input('Tipo', sql.NVarChar, tipo)
            .query("INSERT INTO Carteiras (Usuario, Codigo, Descricao, Tipo) VALUES (@Usuario, @Codigo, @Descricao, @Tipo)");
        
        return `Carteira cadastrada com sucesso! Código: ${codigo}`;
    } catch (err) {
        console.error('Erro ao cadastrar carteira:', err);
        return 'Erro ao cadastrar carteira.';
    }
};

// Função para cadastrar categoria.
const saveCategoriaToDB = async (user, descricao) => {
    try {
        let codigo = await getNextCodigo('Categorias', user);
        let pool = await getConnection();
        await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .input('Descricao', sql.NVarChar, descricao)
            .query("INSERT INTO Categorias (Usuario, Codigo, Descricao) VALUES (@Usuario, @Codigo, @Descricao)");
        return `Categoria cadastrada com sucesso! Código: ${codigo}`;
    } catch (err) {
        console.error('Erro ao cadastrar categoria:', err);
        return 'Erro ao cadastrar categoria.';
    }
};

// Montagem das Mensagens.
client.on('message', async msg => {
    const user = msg.from;
    const message = msg.body.trim();

    if (!userState[user]) {
        userState[user] = {};
    }

    // Chamada do Menu Principal.
    if (message.toLowerCase() === 'menu') {
        userState[user] = { etapa: 'menu' };
        await client.sendMessage(user, 'Menu Principal:\n1 - Entradas\n2 - Saídas\n3 - Ver Saldo\n4 - Carteiras\n5 - Categorias\n6 - Relatórios');
        return;
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
                await consultarSaldo(user);
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
                await listarCarteiras(user);
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
                await listarCategorias(user);
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
        userState[user].valor = valor.toFixed(2);
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
        
        const resumo = `Confirme os dados:\nTipo: ${userState[user].tipo}\nValor: ${userState[user].valor}\nCarteira: ${userState[user].carteira} - ${carteiraDescricao}\nCategoria: ${categoriaSelecionada.Codigo} - ${categoriaSelecionada.Descricao}\nResponda "Ok" para salvar.`;
        
        await client.sendMessage(user, resumo);
        
        return;
    }

    if (userState[user].etapa === 'confirmacao' && message.toLowerCase() === 'ok') {
        await saveTransactionToDB(user, userState[user].tipo, userState[user].valor, userState[user].carteira, userState[user].categoria);
        await client.sendMessage(user, 'Movimentação registrada com sucesso!');
        delete userState[user];
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
            delete userState[user];
            await client.sendMessage(user, 'Operação cancelada com sucesso.');
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
            delete userState[user];
            await client.sendMessage(user, 'Operação cancelada com sucesso.');
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

    // Função para verificar se uma categoria está em uso
    async function checkCategoriaInUse(user, codigoCategoria) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('CodigoCategoria', sql.Int, codigoCategoria)
            .query(`
                SELECT TOP 1 1
                FROM Movimentacoes
                WHERE Usuario = @Usuario AND Categoria = @CodigoCategoria
            `);

        return result.recordset.length > 0;
    }

    // Etapas para exclusão de Categoria via Menu.
    if (userState[user]?.etapa === 'aguardando_codigo_exclusao') {
        if (message.toLowerCase() === 'cancelar') {
            userState[user] = { etapa: 'menu_categorias' };
            await client.sendMessage(user, 'Operação cancelada com sucesso.');
            return;
        }
        await deleteCategoriaFromDB(user, message); // Usa o código informado para excluir
        userState[user] = { etapa: 'menu_categorias' }; // Volta pro menu de categorias após a exclusão
        await client.sendMessage(user, 'Categoria excluída com sucesso!');
        return;
    }

    // Função para excluir uma categoria do banco de dados
    async function deleteCategoriaFromDB(user, codigoCategoria) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('CodigoCategoria', sql.Int, codigoCategoria)
            .query(`
                DELETE FROM Categorias
                WHERE Usuario = @Usuario AND Codigo = @CodigoCategoria
            `);

        return result.rowsAffected[0] > 0;
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
            delete userState[user];
            await client.sendMessage(user, 'Operação cancelada com sucesso.');
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
        delete userState[user];
        await client.sendMessage(user, 'Operação cancelada.');
        return;
    }

    // Atalho da chamada de Saldo.
    if (message.toLowerCase() === 'saldo') {
        await consultarSaldo(user);
        return;
    }

    // Atalho da chamada Listar Carteiras.
    if (message.toLowerCase() === 'listar carteiras') {
        await listarCarteiras(user);
        return;
    }
        
    // Atalho da chamada Listar Categorias.
    if (message.toLowerCase() === 'listar categorias') {
        await listarCategorias(user);
        return;
    }

    // Função que pega as carteiras de um usuário.
    async function getCarteiraIdPorCodigo(user, codigo) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .query(`
            SELECT TOP 1 ID 
            FROM Carteiras 
            WHERE Codigo = @Codigo 
                AND (Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL)
            ORDER BY Usuario DESC
            `);
        
        return result.recordset[0]?.ID;
    }

    // Função para checar a categoria.
    async function checkCategoriaExists(user, descricao) {
        try {
            const pool = await getConnection();
            const result = await pool.request()
                .input('usuario', sql.VarChar, user)
                .input('descricao', sql.VarChar, descricao)
                .query(`SELECT COUNT(*) AS count FROM Categorias WHERE Usuario = @usuario AND Descricao = @descricao`);
    
            return result.recordset[0].count > 0;
        } catch (error) {
            console.error('Erro ao verificar categoria existente:', error);
            throw error;
        }
    }

    // Função para Listar Categorias para Exclusão.
    async function listCategorias(user) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query(`
                SELECT Codigo, Descricao, Usuario
                FROM Categorias
                WHERE Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL
                ORDER BY Codigo
            `);
    
        const categorias = result.recordset;
    
        if (categorias.length === 0) {
            await client.sendMessage(user, 'Nenhuma categoria encontrada.');
        }

        return categorias;
    }

    // Função para consultar saldo.
    async function consultarSaldo(user) {
        const carteiras = await getCarteiras(user);
        
        if (carteiras.length === 0) {
            await client.sendMessage(user, 'Você não tem nenhuma carteira cadastrada.');
            return;
        }
        
        if (carteiras.length === 1) {
            const carteiraSelecionada = carteiras[0].Codigo;
            await exibirSaldo(user, carteiraSelecionada);
        } else {
            userState[user].etapa = 'selecionarCarteiraSaldo';
            const carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
            await client.sendMessage(user, `Escolha uma carteira para verificar o saldo:\n${carteiraMsg}\n(Envie o código da carteira)`);
        }
    }
        
    if (userState[user]?.etapa === 'selecionarCarteiraSaldo') {
        const carteiras = await getCarteiras(user);
        const carteiraSelecionada = carteiras.find(c => c.Codigo === parseInt(message));
        
        if (!carteiraSelecionada) {
            await client.sendMessage(user, 'Código de carteira inválido. Escolha uma das opções apresentadas.');
            return;
        }
        
        await exibirSaldo(user, carteiraSelecionada.Codigo);
    }
        
    async function exibirSaldo(user, carteiraCodigo) {
        const carteiraId = await getCarteiraIdPorCodigo(user, carteiraCodigo);
        
        if (!carteiraId) {
            await client.sendMessage(user, 'Carteira não encontrada. Verifique o código informado.');
            return;
        }
        
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.VarChar, user)
            .input('Carteira', sql.Int, carteiraId)
            .query(`
            SELECT 
                (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Carteira = @Carteira AND Tipo = 'Crédito') -
                (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Carteira = @Carteira AND Tipo = 'Débito') 
            AS Saldo
            `);    
        
        const saldo = result.recordset[0]?.Saldo ?? 0;
        
        await client.sendMessage(user, `O saldo da carteira selecionada é: R$ ${saldo.toFixed(2)}`);
        
        delete userState[user].carteira;
        delete userState[user].etapa;
    }

    //Função Listar Carteiras    
    async function listarCarteiras(user) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query(`
                SELECT Codigo, Descricao
                FROM Carteiras
                WHERE Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL
                ORDER BY Codigo
            `);
        
        const carteiras = result.recordset;
        
        if (carteiras.length === 0) {
            await client.sendMessage(user, 'Nenhuma carteira encontrada.');
            return;
        }
        
        const carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Suas carteiras:\n${carteiraMsg}`);
    }
    
    //Função Listar Categorias
    async function listarCategorias(user) {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query(`
                SELECT Codigo, Descricao
                FROM Categorias
                WHERE Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL
                ORDER BY Codigo
            `);
        
        const categorias = result.recordset;
        
        if (categorias.length === 0) {
            await client.sendMessage(user, 'Nenhuma categoria encontrada.');
            return;
        }
        
        const categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Suas categorias:\n${categoriaMsg}`);
    }
    
    module.exports = { exibirSaldo, consultarSaldo, listarCarteiras, listarCategorias };

});

client.initialize();
