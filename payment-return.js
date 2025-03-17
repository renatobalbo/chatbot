// payment-return.js - Página de retorno após pagamento
const express = require('express');
const { verificarAssinatura } = require('./subscription');
const { registrarInteracao } = require('./interactionLog');

// Adicionar estas rotas ao webhook.js ou criar um arquivo separado
module.exports = function(app) {
    // Página de sucesso
    app.get('/assinatura/retorno', async (req, res) => {
        const usuario = req.query.usuario;
        const status = req.query.status || 'pending';
        
        if (!usuario) {
            return res.status(400).send('<h1>Erro: Usuário não identificado</h1>');
        }
        
        try {
            // Registrar retorno
            await registrarInteracao(
                usuario,
                'RETORNO_PAGAMENTO',
                status,
                'Usuário redirecionado após pagamento',
                'pagamento',
                'RETORNO',
                { 
                    status,
                    queryParams: req.query
                }
            );
            
            // Verificar status atual da assinatura
            const assinatura = await verificarAssinatura(usuario);
            
            // HTML responsivo da página de retorno
            const htmlResponse = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Assinatura - FinançasBot</title>
                <style>
                    body {
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        margin: 0;
                        padding: 0;
                        background-color: #f5f8fa;
                        color: #333;
                    }
                    .container {
                        max-width: 600px;
                        margin: 50px auto;
                        padding: 30px;
                        background-color: white;
                        border-radius: 10px;
                        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                        text-align: center;
                    }
                    .logo {
                        margin-bottom: 20px;
                        font-size: 24px;
                        font-weight: bold;
                        color: #336699;
                    }
                    .status-icon {
                        font-size: 72px;
                        margin: 20px 0;
                    }
                    .success { color: #28a745; }
                    .pending { color: #ffc107; }
                    .error { color: #dc3545; }
                    h1 {
                        font-size: 24px;
                        margin-bottom: 15px;
                        color: #336699;
                    }
                    p {
                        font-size: 16px;
                        line-height: 1.6;
                        margin-bottom: 20px;
                    }
                    .button {
                        display: inline-block;
                        background-color: #336699;
                        color: white;
                        padding: 12px 24px;
                        border-radius: 5px;
                        text-decoration: none;
                        font-weight: bold;
                        margin-top: 20px;
                        transition: background-color 0.3s;
                    }
                    .button:hover {
                        background-color: #264d73;
                    }
                    .info {
                        margin-top: 30px;
                        padding-top: 20px;
                        border-top: 1px solid #eee;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="logo">FinançasBot</div>
                    
                    ${assinatura.ativo ? `
                        <div class="status-icon success">✅</div>
                        <h1>Assinatura Ativada com Sucesso!</h1>
                        <p>Parabéns! Sua assinatura foi confirmada e você já pode aproveitar todos os recursos premium do FinançasBot.</p>
                        <p>Agora você tem acesso a relatórios avançados, carteiras e categorias ilimitadas, e muito mais!</p>
                    ` : status === 'pending' ? `
                        <div class="status-icon pending">⏳</div>
                        <h1>Assinatura em Processamento</h1>
                        <p>Seu pagamento está sendo processado. Assim que for confirmado, sua assinatura será ativada automaticamente.</p>
                        <p>Este processo pode levar alguns minutos. Você receberá uma notificação quando estiver tudo pronto.</p>
                    ` : `
                        <div class="status-icon pending">⏳</div>
                        <h1>Pagamento Pendente</h1>
                        <p>Parece que ainda não identificamos seu pagamento. Se você já concluiu o pagamento, aguarde alguns instantes.</p>
                        <p>Caso não tenha finalizado o pagamento, entre novamente no chat e digite "planos" para gerar um novo link.</p>
                    `}
                    
                    <a href="whatsapp://send?phone=5500000000000&text=status" class="button">Voltar para o Chat</a>
                    
                    <div class="info">
                        <p>Dúvidas ou problemas? Entre em contato com nosso suporte pelo WhatsApp.</p>
                    </div>
                </div>
            </body>
            </html>
            `;
            
            res.send(htmlResponse);
        } catch (error) {
            console.error('Erro na página de retorno:', error);
            
            // Registrar erro
            await registrarInteracao(
                usuario,
                'ERRO_PAGINA_RETORNO',
                status,
                `Erro: ${error.message}`,
                'pagamento',
                'ERRO',
                { erro: error.message }
            );
            
            // Página de erro genérica
            res.status(500).send(`
                <h1>Ocorreu um erro</h1>
                <p>Não foi possível processar sua solicitação.</p>
                <p>Por favor, retorne ao chat e verifique o status da sua assinatura digitando "status".</p>
            `);
        }
    });

    return app;
};