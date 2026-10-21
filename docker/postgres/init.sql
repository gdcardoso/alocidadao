-- Executado só na primeira subida do container (volume vazio).
-- app_user é o papel usado pela API: sem superusuário e sem BYPASSRLS,
-- então as políticas de Row-Level Security sempre se aplicam a ele.
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOSUPERUSER NOBYPASSRLS;

-- Banco usado pelos testes de integração.
CREATE DATABASE alocidadao_test OWNER alocidadao;
