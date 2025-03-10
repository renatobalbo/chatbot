// categories.js - Módulo para gerenciamento de categorias
const { getConnection, sql } = require('./database');
const { registrarInteracao } = require('./interactionLog');

// Função para obter o próximo código válido para categorias
const getNextCodigo = async (user) => {
    try {
        let pool = await getConnection();
        let result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .query(`
                SELECT ISNULL(MAX(Codigo), 0) + 1 AS NextCodigo
                FROM Categorias
                WHERE Usuario = @Usuario OR Usuario = 'GERAL'
            `);

        let nextCodigo = result.recordset[0].NextCodigo;

        // Certifica-se de que o código ainda não existe para o usuário específico
        let check = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, nextCodigo)
            .query(`SELECT COUNT(*) AS Count FROM Categorias WHERE Usuario = @Usuario AND Codigo = @Codigo`);

        if (check.recordset[0].Count > 0) {
            // Se já existir, busca o próximo disponível
            let resultAlt = await pool.request()
                .input('Usuario', sql.NVarChar, user)
                .query(`
                    SELECT MIN(Codigo + 1) AS NextCodigo 
                    FROM Categorias 
                    WHERE Usuario = @Usuario 
                    AND (Codigo + 1) NOT IN (SELECT Codigo FROM Categorias WHERE Usuario = @Usuario)
                `);

            nextCodigo = resultAlt.recordset[0].NextCodigo || nextCodigo;
        }
        return nextCodigo;
    } catch (err) {
        console.error(`Erro ao obter próximo código para Categorias:`, err);
        return 1;
    }
};

// Função para obter opções de categoria do usuário
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

// Função para cadastrar categoria
const saveCategoriaToDB = async (user, descricao) => {
    try {
        let codigo = await getNextCodigo(user);
        let pool = await getConnection();
        await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('Codigo', sql.Int, codigo)
            .input('Descricao', sql.NVarChar, descricao)
            .query("INSERT INTO Categorias (Usuario, Codigo, Descricao) VALUES (@Usuario, @Codigo, @Descricao)");
        
        const mensagem = `Categoria cadastrada com sucesso! Código: ${codigo}`;
        
        // Log de cadastro bem-sucedido
        await registrarInteracao(
            user,
            'CATEGORIA_CADASTRO',
            descricao,
            mensagem,
            'cadastro_categoria',
            'SUCESSO',
            { codigo, descricao }
        );
        
        return mensagem;
    } catch (err) {
        console.error('Erro ao cadastrar categoria:', err);
        
        // Log de erro no cadastro
        await registrarInteracao(
            user,
            'CATEGORIA_CADASTRO',
            descricao,
            'Erro ao cadastrar categoria.',
            'cadastro_categoria',
            'ERRO',
            { 
                descricao,
                erro: err.message 
            }
        );
        
        return 'Erro ao cadastrar categoria.';
    }
};

// Função para verificar se uma categoria já existe
const checkCategoriaExists = async (user, descricao) => {
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
};

// Função para verificar se uma categoria está em uso
const checkCategoriaInUse = async (user, codigoCategoria) => {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('CodigoCategoria', sql.Int, codigoCategoria)
            .query(`
                SELECT TOP 1 1
                FROM Movimentacoes
                WHERE Usuario = @Usuario AND Categoria = @CodigoCategoria
            `);

        const emUso = result.recordset.length > 0;
        
        // Log da verificação
        await registrarInteracao(
            user,
            'VERIFICACAO_CATEGORIA',
            codigoCategoria.toString(),
            emUso ? `Categoria ${codigoCategoria} está em uso` : `Categoria ${codigoCategoria} não está em uso`,
            'verificacao_uso',
            'VERIFICADO',
            { 
                codigo: codigoCategoria,
                emUso
            }
        );

        return emUso;
    } catch (error) {
        console.error('Erro ao verificar uso da categoria:', error);
        
        // Log de erro na verificação
        await registrarInteracao(
            user,
            'VERIFICACAO_CATEGORIA',
            codigoCategoria.toString(),
            `Erro ao verificar uso: ${error.message}`,
            'verificacao_uso',
            'ERRO',
            { 
                codigo: codigoCategoria,
                erro: error.message 
            }
        );
        
        // Em caso de erro, assumir que está em uso por segurança
        return true;
    }
};

// Função para excluir uma categoria do banco de dados
const deleteCategoriaFromDB = async (user, codigoCategoria) => {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Usuario', sql.NVarChar, user)
            .input('CodigoCategoria', sql.Int, codigoCategoria)
            .query(`
                DELETE FROM Categorias
                WHERE Usuario = @Usuario AND Codigo = @CodigoCategoria
            `);

        const sucesso = result.rowsAffected[0] > 0;
        
        // Log da operação de exclusão
        await registrarInteracao(
            user,
            'CATEGORIA_EXCLUSAO',
            codigoCategoria.toString(),
            sucesso ? `Categoria ${codigoCategoria} excluída` : `Categoria ${codigoCategoria} não encontrada`,
            'exclusao_categoria',
            sucesso ? 'SUCESSO' : 'FALHA',
            { 
                codigo: codigoCategoria,
                linhasAfetadas: result.rowsAffected[0]
            }
        );

        return sucesso;
    } catch (error) {
        console.error('Erro ao excluir categoria:', error);
        
        // Log de erro na exclusão
        await registrarInteracao(
            user,
            'CATEGORIA_EXCLUSAO',
            codigoCategoria.toString(),
            `Erro ao excluir categoria: ${error.message}`,
            'exclusao_categoria',
            'ERRO',
            { 
                codigo: codigoCategoria,
                erro: error.message 
            }
        );
        
        return false;
    }
};

// Função para listar categorias
const listCategorias = async (user) => {
    const pool = await getConnection();
    const result = await pool.request()
        .input('Usuario', sql.NVarChar, user)
        .query(`
            SELECT Codigo, Descricao, Usuario
            FROM Categorias
            WHERE Usuario = @Usuario OR Usuario = 'GERAL' OR Usuario IS NULL
            ORDER BY Codigo
        `);

    return result.recordset;
};

// Função para enviar a lista de categorias ao usuário
const listarCategorias = async (client, user) => {
    try {
        const categorias = await listCategorias(user);
        
        if (categorias.length === 0) {
            const mensagem = 'Nenhuma categoria encontrada.';
            await client.sendMessage(user, mensagem);
            
            // Log de lista vazia
            await registrarInteracao(
                user,
                'LISTAR_CATEGORIAS',
                'Listar categorias',
                mensagem,
                'listagem',
                'VAZIO',
                {}
            );
            return;
        }
        
        const categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await client.sendMessage(user, `Suas categorias:\n${categoriaMsg}`);
        
        // Log de listagem bem-sucedida
        await registrarInteracao(
            user,
            'LISTAR_CATEGORIAS',
            'Listar categorias',
            `${categorias.length} categorias listadas`,
            'listagem',
            'SUCESSO',
            { 
                quantidade: categorias.length,
                codigos: categorias.map(c => c.Codigo)
            }
        );
    } catch (error) {
        console.error('Erro ao listar categorias:', error);
        
        // Log de erro na listagem
        await registrarInteracao(
            user,
            'LISTAR_CATEGORIAS',
            'Listar categorias',
            'Erro ao listar categorias',
            'listagem',
            'ERRO',
            { erro: error.message }
        );
        
        await client.sendMessage(user, 'Ocorreu um erro ao listar suas categorias.');
    }
};

// Exportar todas as funções relacionadas a categorias
module.exports = { getCategorias, saveCategoriaToDB, checkCategoriaExists, checkCategoriaInUse, deleteCategoriaFromDB, listCategorias, listarCategorias };
