public class StringFormatSqlService
{
    public string Build(int userId)
    {
        var sql = $"SELECT * FROM Users WHERE Id = {userId}";
        return sql;
    }
}