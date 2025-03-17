// wallets.js - Módulo para gerenciamento de carteiras
const { getConnection, sql } = require('./database');
const { registrarInteracao } = require('./interactionLog');

// Função para obter o próximo código válido para carteiras
const getNextCodigo = async (user) => {
    try {
        let pool = await getConnection();
        let result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query(`
                SELECT ISNULL(MAX(Codigo), 0) + 1 AS NextCodigo
                FROM Carteiras
                WHERE Usuario = @Usuario OR Usuario = 'GERAL'
            `);

        let nextCodigo = result.recordset[0].NextCodigo;

        // Certifica-se de que o código ainda não existe para o usuário específico
        let check = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, nextCodigo)
            .query(`SELECT COUNT(*) AS Count FROM Carteiras WHERE Usuario = @Usuario AND Codigo = @Codigo`);

        if (check.recordset[0].Count > 0) {
            // Se já existir, busca o próximo disponível
            let resultAlt = await pool.request()
                .input('Usuario', sql.NVarChar, user)
                .query(`
                    SELECT MIN(Codigo + 1) AS NextCodigo 
                    FROM Carteiras 
                    WHERE Usuario = @Usuario 
                    AND (Codigo + 1) NOT IN (SELECT Codigo FROM Carteiras WHERE Usuario = @Usuario)
                `);

            nextCodigo = resultAlt.recordset[0].NextCodigo || nextCodigo;
        }
        return nextCodigo;
    } catch (err) {
        console.error(`Erro ao obter próximo código para Carteiras:`, err);
        return 1;
    }
};

// Função para obter opções de carteira do usuário
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

// Função para salvar carteira
const saveCarteiraToDB = async (user, descricao, tipo) => {
    try {
        let pool = await getConnection();

        let codigo = await getNextCodigo(user);

        // Verifica se o código gerado já existe
        let check = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .query("SELECT COUNT(*) AS Count FROM Carteiras WHERE Usuario = @Usuario AND Codigo = @Codigo");

        if (check.recordset[0].Count > 0) {
            console.error(`Código ${codigo} já existe para o usuário ${user}, gerando novo código...`);
            
            // Log de conflito de código
            await registrarInteracao(
                user,
                'CARTEIRA_CONFLITO',
                `Código ${codigo} já existe`,
                null,
                'verificacao_codigo',
                'CONFLITO',
                { codigo, descricao, tipo }
            );
            
            codigo = await getNextCodigo(user); // Tenta gerar novamente
        }

        await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .input('Descricao', sql.NVarChar, descricao)
            .input('Tipo', sql.NVarChar, tipo)
            .query("INSERT INTO Carteiras (Usuario, Codigo, Descricao, Tipo) VALUES (@Usuario, @Codigo, @Descricao, @Tipo)");
        
        const mensagem = `Carteira cadastrada com sucesso! Código: ${codigo}`;
        
        // Log de sucesso no cadastro
        await registrarInteracao(
            user,
            'CARTEIRA_CADASTRO',
            `${descricao} (${tipo})`,
            mensagem,
            'cadastro_carteira',
            'SUCESSO',
            { codigo, descricao, tipo }
        );
        
        return mensagem;
    } catch (err) {
        console.error('Erro ao cadastrar carteira:', err);
        
        // Log de erro no cadastro
        await registrarInteracao(
            user,
            'CARTEIRA_CADASTRO',
            `${descricao} (${tipo})`,
            'Erro ao cadastrar carteira.',
            'cadastro_carteira',
            'ERRO',
            { 
                descricao, 
                tipo,
                erro: err.message 
            }
        );
        
        return 'Erro ao cadastrar carteira.';
    }
};

// Função para obter o ID da carteira por código
const getCarteiraIdPorCodigo = async (user, codigo) => {
    try {
        // Garantir que o código seja um número inteiro para comparação exata
        const codigoInt = parseInt(codigo, 10);
        
        if (isNaN(codigoInt)) {
            console.error(`Código de carteira inválido: ${codigo}`);
            return null;
        }
        
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigoInt) // Use sql.Int para garantir comparação numérica
            .query(`
            SELECT TOP 1 ID 
            FROM Carteiras 
            WHERE Codigo = @Codigo 
                AND (Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL)
            ORDER BY Usuario DESC
            `);
        
        if (result.recordset.length === 0) {
            console.log(`Nenhuma carteira encontrada com código ${codigoInt} para usuário ${user}`);
            return null;
        }
        
        return result.recordset[0].ID;
    } catch (error) {
        console.error('Erro ao obter ID da carteira:', error);
        return null;
    }
};

// Função para consultar saldo
const consultarSaldo = async (client, user) => {
    const carteiras = await getCarteiras(user);
    
    if (carteiras.length === 0) {
        await client.sendMessage(user, 'Você não tem nenhuma carteira cadastrada.');
        return;
    }
    
    if (carteiras.length === 1) {
        const carteiraSelecionada = carteiras[0].Codigo;
        await exibirSaldo(client, user, carteiraSelecionada);
    } else {
        // Aqui é necessário que o chatbot.js gerencie o estado do usuário
        const carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Escolha uma carteira para verificar o saldo:\n${carteiraMsg}\n(Envie o código da carteira)`);
        return {
            etapa: 'selecionarCarteiraSaldo'
        };
    }
};

// Função para exibir saldo
const exibirSaldo = async (client, user, carteiraCodigo) => {
    // Converter para número para garantir comparação exata
    const carteiraCodigoInt = parseInt(carteiraCodigo, 10);
    
    if (isNaN(carteiraCodigoInt)) {
        const mensagemErro = 'Código de carteira inválido. Deve ser um número.';
        await client.sendMessage(user, mensagemErro);
        
        // Log de erro - código inválido
        await registrarInteracao(
            user,
            'CONSULTA_SALDO',
            carteiraCodigo.toString(),
            mensagemErro,
            'validacao_codigo',
            'ERRO',
            { codigoInvalido: carteiraCodigo }
        );
        
        return;
    }
    
    const carteiraId = await getCarteiraIdPorCodigo(user, carteiraCodigoInt);
    
    if (!carteiraId) {
        const mensagemErro = 'Carteira não encontrada. Verifique o código informado.';
        await client.sendMessage(user, mensagemErro);
        
        // Log de erro - carteira não encontrada
        await registrarInteracao(
            user,
            'CONSULTA_SALDO',
            carteiraCodigoInt.toString(),
            mensagemErro,
            'busca_carteira',
            'ERRO',
            { carteiraCodigo: carteiraCodigoInt }
        );
        
        return;
    }
    
    const pool = await getConnection();
    const result = await pool.request()
        .input('Usuario', sql.VarChar, user)
        .input('Carteira', sql.Int, carteiraId) // Garantir que é um inteiro
        .query(`
        SELECT 
            (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Carteira = @Carteira AND Tipo = 'Crédito') -
            (SELECT ISNULL(SUM(Valor), 0) FROM Movimentacoes WHERE Usuario = @Usuario AND Carteira = @Carteira AND Tipo = 'Débito') 
        AS Saldo
        `);    
    
    const saldo = result.recordset[0]?.Saldo ?? 0;
    
    // Formatar o saldo usando Intl.NumberFormat para incluir separador de milhar
    const saldoFormatado = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(saldo);

    const mensagemSaldo = `O saldo da carteira selecionada é: ${saldoFormatado}`;
    await client.sendMessage(user, mensagemSaldo);
    
    // Log de consulta de saldo com sucesso
    await registrarInteracao(
        user,
        'CONSULTA_SALDO',
        carteiraCodigoInt.toString(),
        mensagemSaldo,
        'exibicao_saldo',
        'SUCESSO',
        { 
            carteiraCodigo: carteiraCodigoInt,
            carteiraId,
            saldo
        }
    );
    
    return true;
};

// Função para listar carteiras
const listarCarteiras = async (client, user) => {
    try {
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
            const mensagem = 'Nenhuma carteira encontrada.';
            await client.sendMessage(user, mensagem);
            
            // Log de lista vazia
            await registrarInteracao(
                user,
                'LISTAR_CARTEIRAS',
                'Listar carteiras',
                mensagem,
                'listagem',
                'VAZIO',
                {}
            );
            return;
        }
        
        const carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Suas carteiras:\n${carteiraMsg}`);
        
        // Log de listagem bem-sucedida
        await registrarInteracao(
            user,
            'LISTAR_CARTEIRAS',
            'Listar carteiras',
            `${carteiras.length} carteiras listadas`,
            'listagem',
            'SUCESSO',
            { 
                quantidade: carteiras.length,
                codigos: carteiras.map(c => c.Codigo)
            }
        );
    } catch (error) {
        console.error('Erro ao listar carteiras:', error);
        
        // Log de erro na listagem
        await registrarInteracao(
            user,
            'LISTAR_CARTEIRAS',
            'Listar carteiras',
            'Erro ao listar carteiras',
            'listagem',
            'ERRO',
            { erro: error.message }
        );
        
        await client.sendMessage(user, 'Ocorreu um erro ao listar suas carteiras.');
    }
};

module.exports = { getNextCodigo, getCarteiras, saveCarteiraToDB, getCarteiraIdPorCodigo, consultarSaldo, exibirSaldo, listarCarteiras };
