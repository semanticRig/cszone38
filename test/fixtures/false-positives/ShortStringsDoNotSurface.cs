public class ShortStringsDoNotSurface
{
    public string Match(dynamic arguments)
    {
        var claimName = arguments["name"].ToString();
        return claimName == "role" ? "sort" : "none";
    }
}