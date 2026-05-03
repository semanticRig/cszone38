using System;

public class InterpolatedStringSamples
{
    public void Run(string token, User user, string name)
    {
        var bearer = $"Bearer {token}";
        var audit = $"User {user.Name} logged in at {DateTime.Now}";
        var path = $@"path\{name}";
        var braces = $"{{literal braces}}";
    }
}

public class User
{
    public string Name { get; set; }
}