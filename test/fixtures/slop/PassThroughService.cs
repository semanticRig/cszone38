public class PassThroughService
{
    private readonly InnerService _inner;

    public PassThroughService(InnerService inner)
    {
        _inner = inner;
    }

    public int Run()
    {
        return _inner.Run();
    }
}

public class InnerService
{
    public int Run()
    {
        return 1;
    }
}