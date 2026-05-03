using System.Threading.Tasks;

public class SwallowedTaskExceptionService
{
    public Task Run()
    {
        return Task.Run(WorkAsync).ContinueWith(task => Log("done"));
    }

    private Task WorkAsync()
    {
        return Task.CompletedTask;
    }

    private void Log(string message)
    {
    }
}