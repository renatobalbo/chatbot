// userManagement.js
const { getConnection, sql } = require('./database');

// Verificar se um usuário já está registrado no banco de dados
async function isUserRegistered(phone) {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .query('SELECT COUNT(*) AS Count FROM Usuarios WHERE Telefone = @Telefone');
        
        return result.recordset[0].Count > 0;
    } catch (error) {
        console.error('Erro ao verificar registro de usuário:', error);
        return false;
    }
}

// Registrar um novo usuário no banco de dados
async function registerUser(phone, userName = null) {
    try {
        const pool = await getConnection();
        await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .input('Nome', sql.NVarChar, userName)
            .input('DataCadastro', sql.DateTime, new Date())
            .input('UltimaAtividade', sql.DateTime, new Date())
            .query(`
                INSERT INTO Usuarios (Telefone, Nome, DataCadastro, UltimaAtividade) 
                VALUES (@Telefone, @Nome, @DataCadastro, @UltimaAtividade)
            `);
        
        console.log(`Novo usuário registrado: ${phone}`);
        return true;
    } catch (error) {
        console.error('Erro ao registrar usuário:', error);
        return false;
    }
}

// Atualizar o registro de atividade do usuário
async function updateUserActivity(phone) {
    try {
        const pool = await getConnection();
        await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .input('UltimaAtividade', sql.DateTime, new Date())
            .query(`
                UPDATE Usuarios 
                SET UltimaAtividade = @UltimaAtividade, 
                    DataAtualizacao = @UltimaAtividade
                WHERE Telefone = @Telefone
            `);
    } catch (error) {
        console.error('Erro ao atualizar atividade do usuário:', error);
    }
}

// Atualizar o nome do usuário
async function updateUserName(phone, name) {
    try {
        const pool = await getConnection();
        await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .input('Nome', sql.NVarChar, name)
            .input('DataAtualizacao', sql.DateTime, new Date())
            .query(`
                UPDATE Usuarios 
                SET Nome = @Nome, 
                    DataAtualizacao = @DataAtualizacao
                WHERE Telefone = @Telefone
            `);
    } catch (error) {
        console.error('Erro ao atualizar nome do usuário:', error);
    }
}

// Verificar se o usuário é PRO
async function isUserPro(phone) {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .query('SELECT UsuarioPro FROM Usuarios WHERE Telefone = @Telefone');
        
        if (result.recordset.length === 0) return false;
        return result.recordset[0].UsuarioPro === true;
    } catch (error) {
        console.error('Erro ao verificar status PRO do usuário:', error);
        return false;
    }
}

// Atualizar status PRO do usuário
async function updateUserProStatus(phone, isProUser) {
    try {
        const pool = await getConnection();
        await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .input('UsuarioPro', sql.Bit, isProUser ? 1 : 0)
            .input('DataAtualizacao', sql.DateTime, new Date())
            .query(`
                UPDATE Usuarios 
                SET UsuarioPro = @UsuarioPro, 
                    DataAtualizacao = @DataAtualizacao
                WHERE Telefone = @Telefone
            `);
    } catch (error) {
        console.error('Erro ao atualizar status PRO do usuário:', error);
    }
}

// Obter informações do usuário
async function getUserInfo(phone) {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .query('SELECT * FROM Usuarios WHERE Telefone = @Telefone');
        
        if (result.recordset.length === 0) return null;
        return result.recordset[0];
    } catch (error) {
        console.error('Erro ao obter informações do usuário:', error);
        return null;
    }
}

// Desativar um usuário
async function deactivateUser(phone) {
    try {
        const pool = await getConnection();
        await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .input('DataAtualizacao', sql.DateTime, new Date())
            .query(`
                UPDATE Usuarios 
                SET Ativo = 0, 
                    DataAtualizacao = @DataAtualizacao
                WHERE Telefone = @Telefone
            `);
    } catch (error) {
        console.error('Erro ao desativar usuário:', error);
    }
}

// Reativar um usuário
async function reactivateUser(phone) {
    try {
        const pool = await getConnection();
        await pool.request()
            .input('Telefone', sql.NVarChar, phone)
            .input('DataAtualizacao', sql.DateTime, new Date())
            .query(`
                UPDATE Usuarios 
                SET Ativo = 1, 
                    DataAtualizacao = @DataAtualizacao
                WHERE Telefone = @Telefone
            `);
    } catch (error) {
        console.error('Erro ao reativar usuário:', error);
    }
}

// Listar os usuários mais ativos
async function getActiveUsers(limit = 10) {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .input('Limit', sql.Int, limit)
            .query(`
                SELECT TOP (@Limit) 
                    Telefone, 
                    Nome, 
                    UsuarioPro, 
                    Ativo, 
                    UltimaAtividade, 
                    DataCadastro
                FROM Usuarios
                WHERE Ativo = 1
                ORDER BY UltimaAtividade DESC
            `);
        
        return result.recordset;
    } catch (error) {
        console.error('Erro ao listar usuários ativos:', error);
        return [];
    }
}

// Obter estatísticas de usuários
async function getUserStats() {
    try {
        const pool = await getConnection();
        const result = await pool.request()
            .query(`
                SELECT 
                    COUNT(*) AS TotalUsuarios,
                    SUM(CASE WHEN Ativo = 1 THEN 1 ELSE 0 END) AS UsuariosAtivos,
                    SUM(CASE WHEN UsuarioPro = 1 THEN 1 ELSE 0 END) AS UsuariosPro,
                    SUM(CASE WHEN DATEDIFF(DAY, UltimaAtividade, GETDATE()) <= 7 THEN 1 ELSE 0 END) AS AtivosUltimaSemana
                FROM Usuarios
            `);
        
        return result.recordset[0];
    } catch (error) {
        console.error('Erro ao obter estatísticas de usuários:', error);
        return null;
    }
}

module.exports = { isUserRegistered, registerUser, updateUserActivity, updateUserName, isUserPro, updateUserProStatus, getUserInfo, deactivateUser, reactivateUser, getActiveUsers, getUserStats };