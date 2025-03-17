// transactions.js - Gerenciamento de transações financeiras
const { getConnection, sql } = require('./database');
const { registrarInteracao } = require('./interactionLog');
const { getCarteiras, getCarteiraIdPorCodigo, exibirSaldo } = require('./wallets');
const { getCategorias } = require('./categories');

// Classe para gerenciamento de transações financeiras
class TransactionHandler {
    constructor(client, userState) {
        this.client = client;
        this.userState = userState;
    }

    // Iniciar entrada ou saída
    async startTransaction(user, message) {
        if (message.toLowerCase() !== 'entrada' && !['saída', 'saida'].includes(message.toLowerCase())) {
            return false;
        }

        this.userState[user] = { 
            etapa: 'valor', 
            tipo: message.toLowerCase() === 'entrada' ? 'Crédito' : 'Débito'
        };
        
        await this.client.sendMessage(user, 'Qual valor?');
        
        await registrarInteracao(
            user,
            message.toLowerCase() === 'entrada' ? 'INICIO_ENTRADA' : 'INICIO_SAIDA',
            message,
            'Solicitação de valor',
            'inicio_transacao',
            'INICIADO',
            { tipo: this.userState[user].tipo }
        );
        
        return true;
    }

    // Processar valor da transação
    async handleValorStep(user, message) {
        if (this.userState[user]?.etapa !== 'valor') {
            return false;
        }

        const valor = parseFloat(message.replace(',', '.'));
        if (isNaN(valor) || valor <= 0) {
            await this.client.sendMessage(user, 'Valor inválido. Por favor, digite um número válido.');
            return true;
        }
        
        this.userState[user].valor = valor.toFixed(2); // Manter o valor original formatado para cálculos
    
        // Adicionar uma propriedade para o valor formatado para exibição
        this.userState[user].valorFormatado = new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(valor);
        
        const carteiras = await getCarteiras(user);

        if (carteiras.length === 1 && carteiras[0].Codigo === 1) { // Verificação ajustada para número
            this.userState[user].carteira = 1;
            this.userState[user].etapa = 'categoria';
            const categorias = await getCategorias(user);
            const categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
            await this.client.sendMessage(user, `Qual categoria?\n${categoriaMsg}\n(Envie o código da categoria)`);
            return true;
        }

        this.userState[user].etapa = 'carteira';
        const carteiraMsg = carteiras.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await this.client.sendMessage(user, `Qual carteira?\n${carteiraMsg}\n(Envie o código da carteira)`);
        return true;
    }

    // Processar seleção de carteira
    async handleCarteiraStep(user, message) {
        if (this.userState[user]?.etapa !== 'carteira') {
            return false;
        }

        const carteiras = await getCarteiras(user);
        const carteiraSelecionada = carteiras.find(c => String(c.Codigo) === String(message));
        
        if (!carteiraSelecionada) {
            await this.client.sendMessage(user, 'Código de carteira inválido. Escolha uma das opções apresentadas.');
            return true;
        }
        
        this.userState[user].carteira = carteiraSelecionada.Codigo;
        this.userState[user].etapa = 'categoria';
        const categorias = await getCategorias(user);

        const categoriaMsg = categorias.map(c => `${c.Codigo} - ${c.Descricao}`).join('\n');
        await this.client.sendMessage(user, `Qual categoria?\n${categoriaMsg}\n(Envie o código da categoria)`);
        return true;
    }

    // Processar seleção de categoria
    async handleCategoriaStep(user, message) {
        if (this.userState[user]?.etapa !== 'categoria') {
            return false;
        }

        const categorias = await getCategorias(user);
        const categoriaSelecionada = categorias.find(c => c.Codigo === parseInt(message));
        
        if (!categoriaSelecionada) {
            await this.client.sendMessage(user, 'Código de categoria inválido. Escolha uma das opções apresentadas.');
            return true;
        }
        
        this.userState[user].categoria = categoriaSelecionada.Codigo;
        this.userState[user].etapa = 'confirmacao';
    
        const carteiras = await getCarteiras(user); // Busca a lista de carteiras novamente
        const carteiraDescricao = carteiras.find(c => c.Codigo === this.userState[user].carteira)?.Descricao || 'Não encontrado';
        const resumo = `Confirme os dados:\nTipo: ${this.userState[user].tipo}\nValor: ${this.userState[user].valorFormatado}\nCarteira: ${this.userState[user].carteira} - ${carteiraDescricao}\nCategoria: ${categoriaSelecionada.Codigo} - ${categoriaSelecionada.Descricao}\nResponda "Ok" para salvar.`;
        
        await this.client.sendMessage(user, resumo);
        return true;
    }

    // Processar confirmação da transação
    async handleConfirmacaoStep(user, message) {
        if (this.userState[user]?.etapa !== 'confirmacao' || message.toLowerCase() !== 'ok') {
            return false;
        }

        try {
            await this.saveTransactionToDB(
                user, 
                this.userState[user].tipo, 
                this.userState[user].valor, 
                this.userState[user].carteira, 
                this.userState[user].categoria
            );
            
            const mensagemSucesso = 'Movimentação registrada com sucesso!';
            await this.client.sendMessage(user, mensagemSucesso);
            
            // Log da transação bem-sucedida
            await registrarInteracao(
                user,
                this.userState[user].tipo === 'Crédito' ? 'ENTRADA_FINANCEIRA' : 'SAIDA_FINANCEIRA',
                message,
                mensagemSucesso,
                'confirmacao',
                'SUCESSO',
                {
                    valor: this.userState[user].valor,
                    carteira: this.userState[user].carteira,
                    categoria: this.userState[user].categoria
                }
            );
            
            delete this.userState[user];
        } catch (error) {
            console.error('Erro ao salvar transação:', error);
            const mensagemErro = 'Erro ao registrar movimentação. Tente novamente.';
            await this.client.sendMessage(user, mensagemErro);
            
            // Log de erro
            await registrarInteracao(
                user,
                this.userState[user].tipo === 'Crédito' ? 'ENTRADA_FINANCEIRA' : 'SAIDA_FINANCEIRA',
                message,
                mensagemErro,
                'confirmacao',
                'ERRO',
                {
                    valor: this.userState[user].valor,
                    carteira: this.userState[user].carteira,
                    categoria: this.userState[user].categoria,
                    erro: error.message
                }
            );
        }
        
        return true;
    }

    // Handler para consulta de saldo
    async handleSaldoCommand(user, message) {
        if (message.toLowerCase() !== 'saldo') {
            return false;
        }

        const result = await consultarSaldo(this.client, user);
        if (result && result.etapa) {
            this.userState[user].etapa = result.etapa;
        }
        return true;
    }

    // Processar seleção de carteira para saldo
    async handleSaldoCarteiraSelection(user, message) {
        if (this.userState[user]?.etapa !== 'selecionarCarteiraSaldo') {
            return false;
        }

        const carteiras = await getCarteiras(user);
        const carteiraSelecionada = carteiras.find(c => c.Codigo === parseInt(message));
        
        if (!carteiraSelecionada) {
            await this.client.sendMessage(user, 'Código de carteira inválido. Escolha uma das opções apresentadas.');
            return true;
        }
        
        await exibirSaldo(this.client, user, carteiraSelecionada.Codigo);
        delete this.userState[user].etapa;
        return true;
    }

    // Salvar transação no banco de dados
    async saveTransactionToDB(user, tipo, valor, carteiraCodigo, categoria) {
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
    }

    // Cancelar operação atual
    async handleCancelar(user, message) {
        if (message.toLowerCase() !== 'cancelar') {
            return false;
        }

        const etapaAnterior = this.userState[user]?.etapa || 'desconhecida';
        const operacaoAtual = this.userState[user]?.tipo || 'OPERACAO';
        delete this.userState[user];
        
        const mensagemCancelamento = 'Operação cancelada.';
        await this.client.sendMessage(user, mensagemCancelamento);
        
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

        return true;
    }
}

// Função auxiliar para consultar saldo
async function consultarSaldo(client, user) {
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
}

module.exports = { TransactionHandler, consultarSaldo };